import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { SessionEventType } from '@deepseek-ai/dsh-session'

/**
 * Reading a session log means reading two different shapes through one API.
 *
 * The session log stores a `user/message` event as the message itself
 * (`data.content`, `data.role`), while `assistant/message` and
 * `system/message` wrap it as `data.message`. Treating them uniformly yields
 * silent empty strings rather than an error, so both shapes are handled here,
 * once, and covered by tests.
 */

/** Surface event types whose payload can carry readable conversation. */
export type ReadableEventType = Extract<
  SessionEventType,
  'user/message' | 'assistant/message' | 'system/message'
>

export type ReadableRole = 'user' | 'assistant' | 'system'

const READABLE_TYPES: readonly ReadableEventType[] = [
  'user/message',
  'assistant/message',
  'system/message',
]

/** Whether one raw event type carries conversation this plugin will render. */
export function isReadableEventType(type: string): type is ReadableEventType {
  return (READABLE_TYPES as readonly string[]).includes(type)
}

/** Map an event type onto the role it represents in the transcript. */
export function roleOf(type: ReadableEventType): ReadableRole {
  switch (type) {
    case 'user/message':
      return 'user'
    case 'assistant/message':
      return 'assistant'
    case 'system/message':
      return 'system'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isContentBlock(value: unknown): value is ContentBlock {
  return isRecord(value) && typeof value['type'] === 'string'
}

/**
 * Recover the message object from one event's `data`, whichever shape it uses.
 *
 * @param data - the raw `data` field of a session event.
 * @returns the message, or `undefined` when this event holds none.
 */
export function messageOf(data: unknown): Message | undefined {
  if (!isRecord(data)) return undefined

  // Shape A: a user/message stores the message directly.
  const directContent = data['content']
  if (Array.isArray(directContent) && typeof data['role'] === 'string') {
    if (!directContent.every(isContentBlock)) return undefined
    return data as unknown as Message
  }

  // Shape B: assistant/message and system/message wrap it as `data.message`.
  const wrapped = data['message']
  if (
    isRecord(wrapped) &&
    Array.isArray(wrapped['content']) &&
    typeof wrapped['role'] === 'string'
  ) {
    if (!wrapped['content'].every(isContentBlock)) return undefined
    return wrapped as unknown as Message
  }

  return undefined
}

/**
 * Concatenate only the text blocks of one event.
 *
 * Reasoning blocks are deliberately dropped: they are model-internal, they
 * dominate the byte cost of an assistant turn, and forwarding them would leak
 * one session's scratchpad into another's context.
 */
export function textOf(data: unknown): string {
  const message = messageOf(data)
  if (message === undefined) return ''
  return message.content
    .filter(
      (block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text',
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** A short, stable label for where a message came from. */
export function sourceLabelOf(data: unknown): string {
  const message = messageOf(data)
  const source = message?.source
  if (source === undefined) return 'unknown'

  switch (source.kind) {
    case 'user':
      return 'user'
    case 'model':
      return `model:${source.provider}/${source.model}`
    case 'plugin':
      return source.form === undefined
        ? `plugin:${source.plugin}`
        : `plugin:${source.plugin}/${source.form}`
    case 'tool':
      return 'tool'
  }
}

/**
 * Prefixes that mark a `user/message` as harness-injected context rather than
 * something the human typed.
 *
 * These messages are real session events and are indistinguishable by shape, so
 * detection is by content. The list covers the injections the Harness itself
 * and the common context plugins perform; it is intentionally a denylist of
 * prefixes and never a filter on user text.
 */
const INJECTED_PREFIXES: readonly string[] = [
  '<system-reminder>',
  'Current runtime context.',
  '[MNEMON]',
  'MNEMON RUNTIME MEMORY SNAPSHOT',
]

/** Whether one already-extracted message body looks harness-injected. */
export function isInjectedText(text: string): boolean {
  const head = text.trimStart()
  return INJECTED_PREFIXES.some((prefix) => head.startsWith(prefix))
}

/** Truncate to a character budget, appending a visible marker. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`
}
