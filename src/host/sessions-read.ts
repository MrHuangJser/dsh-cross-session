import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session'

import {
  type ReadableRole,
  clip,
  isInjectedText,
  isReadableEventType,
  roleOf,
  sourceLabelOf,
  textOf,
} from '../shared/events.ts'

/** One rendered turn of another session's current conversation. */
export interface TranscriptItem {
  readonly seq: number
  readonly role: ReadableRole
  readonly text: string
  readonly source: string
  /** True when the body matched a known harness-injection prefix. */
  readonly injected: boolean
  /** True when a later event replaced this one; it is no longer in context. */
  readonly replaced: boolean
}

/** The projected conversation of one other session. */
export interface Transcript {
  readonly sessionId: string
  readonly title: string
  readonly kind: 'top-level' | 'subagent'
  readonly live: boolean
  readonly cwd?: string
  readonly capturedThroughSeq: number | null
  readonly items: readonly TranscriptItem[]
  /** Messages that existed but were dropped by the window or the filters. */
  readonly omitted: number
  /** Total readable messages found before filtering. */
  readonly total: number
}

export interface ReadRequest {
  readonly sessionId: string
  /** Maximum messages to return; already clamped by the caller's settings. */
  readonly maxMessages: number
  /** Per-message character budget. */
  readonly maxChars: number
  /** Include harness-injected context as well as human and model turns. */
  readonly includeInjected: boolean
  /** Include `system/message` rows, which are usually plugin notices. */
  readonly includeSystem: boolean
  /** Render a truncation marker instead of silently cutting. */
  readonly markTruncated?: boolean
}

/**
 * Project one session's *current model surface* into a readable transcript.
 *
 * The surface is used rather than the raw event log on purpose: it is the exact
 * set of messages the session's own model sees right now, it already excludes
 * superseded and log-only events, and it costs one backend read instead of one
 * read per message.
 *
 * @param query - the session query service.
 * @param request - target session and rendering budgets.
 * @param signal - caller cancellation.
 * @returns the projected transcript.
 * @throws when the session cannot be resolved or its surface fails validation.
 */
export async function readSession(
  query: SessionQueryService,
  request: ReadRequest,
  signal: AbortSignal,
): Promise<Transcript> {
  const sessionId = request.sessionId as SessionSurfaceSnapshot['session']['id']

  const title = await query.readTitle(sessionId, signal).catch(() => undefined)
  const surface = await query.readSurface(sessionId)

  const collected: TranscriptItem[] = []

  for (const event of surface.events) {
    if (signal.aborted) break
    if (!isReadableEventType(event.type)) continue

    const role = roleOf(event.type)
    if (role === 'system' && !request.includeSystem) continue

    const text = textOf(event.data)
    if (text.length === 0) continue

    const injected = isInjectedText(text)
    if (injected && !request.includeInjected) continue

    const surfaceOp = (event as { surfaceOp?: unknown }).surfaceOp
    const replaced =
      typeof surfaceOp === 'object' && surfaceOp !== null && 'op' in surfaceOp
        ? surfaceOp.op === 'replace'
        : false

    collected.push({
      seq: Number(event.seq),
      role,
      text: request.markTruncated === false ? text : clip(text, request.maxChars),
      source: sourceLabelOf(event.data),
      injected,
      replaced,
    })
  }

  const total = collected.length
  const window = collected.slice(Math.max(0, total - request.maxMessages))

  return {
    sessionId: String(surface.session.id),
    title: title?.title ?? '(untitled)',
    kind: surface.session.origin === 'subagent' ? 'subagent' : 'top-level',
    live: true,
    ...(surface.session.cwd === undefined ? {} : { cwd: surface.session.cwd }),
    capturedThroughSeq:
      surface.capturedThroughSeq === null ? null : Number(surface.capturedThroughSeq),
    items: window,
    omitted: total - window.length,
    total,
  }
}

/** Render a transcript as the model-facing text block. */
export function renderTranscript(transcript: Transcript): string {
  const lines: string[] = []
  const where = transcript.cwd === undefined ? '' : ` | cwd=${transcript.cwd}`
  lines.push(
    `session ${transcript.sessionId} [${transcript.live ? 'live' : 'cold'}, ${transcript.kind}]${where}`,
  )
  lines.push(`title: ${clip(transcript.title, 120)}`)
  lines.push(
    `readable messages: ${transcript.total} | captured through seq: ${String(
      transcript.capturedThroughSeq,
    )}`,
  )

  if (transcript.items.length === 0) {
    lines.push('(no readable conversation in this session)')
    return lines.join('\n')
  }

  for (const item of transcript.items) {
    const marks = [item.source]
    if (item.injected) marks.push('harness-injected')
    if (item.replaced) marks.push('replaced')
    lines.push(`--- ${item.role} (seq ${String(item.seq)}, ${marks.join(', ')}) ---`)
    lines.push(item.text)
  }

  if (transcript.omitted > 0) {
    lines.push(`(${String(transcript.omitted)} earlier messages omitted)`)
  }

  return lines.join('\n')
}
