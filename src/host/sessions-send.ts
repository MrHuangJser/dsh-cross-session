import type {
  PromptDeliveryMode,
  SessionControllerService,
} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-brand'
import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'

import { clip } from '../shared/events.ts'

/** What the sender knows about the sending session. */
export interface SenderIdentity {
  readonly sessionId: string
  readonly title?: string
}

export interface SendRequest {
  readonly sender: SenderIdentity
  readonly targetSessionId: string
  readonly body: string
  readonly mode: PromptDeliveryMode
  /** Whether a cold target may be resumed to receive this message. */
  readonly allowResume: boolean
  /** Whether to prefix the machine-readable sender frame. */
  readonly frame: boolean
  /** Maximum delivered body length; already clamped by the caller's settings. */
  readonly maxChars: number
}

export type SendOutcome =
  | {
      readonly ok: true
      readonly targetSessionId: string
      readonly mode: PromptDeliveryMode
      readonly resumed: boolean
      readonly deliveredChars: number
    }
  | {
      readonly ok: false
      readonly targetSessionId: string
      readonly reason: string
      readonly code: 'not-found' | 'not-messageable' | 'resume-disabled' | 'empty-body' | 'rejected'
    }

/**
 * Monotonic request-id source.
 *
 * The id must be unique per admitted message; the controller replays an id it
 * has already seen as a no-op, which is a useful retry guard but would silently
 * swallow a genuine second message if ids repeated.
 */
let requestCounter = 0

function nextRequestId(): string {
  requestCounter += 1
  return `cross-session-${String(Date.now())}-${String(requestCounter)}`
}

/**
 * Build the model-visible body of a delivered message.
 *
 * Attribution is the whole point of the frame: the receiving session sees a
 * `user` message, so without this header its model cannot tell a peer session
 * from the human operator, and cannot address a reply.
 */
export function frameMessage(request: SendRequest, body: string): string {
  if (!request.frame) return body
  const title =
    request.sender.title === undefined || request.sender.title.length === 0
      ? ''
      : ` ("${clip(request.sender.title, 60)}")`
  return [
    'Cross-session message from another session of this harness.',
    `from-session: ${request.sender.sessionId}${title}`,
    `delivery: ${request.mode}`,
    '--- message begins ---',
    body,
    '--- message ends ---',
  ].join('\n')
}

/** The pre-flight verdict on one target session. */
type Preflight =
  | {
      readonly messageable: false
      readonly wasLive: boolean
      readonly rejection: Extract<SendOutcome, { ok: false }>
    }
  | { readonly messageable: true; readonly wasLive: boolean }

/** Decide whether a target exists and may be messaged. Never throws. */
async function preflight(query: SessionQueryService, targetId: string): Promise<Preflight> {
  const records = await query.listSessions()
  const record = records.find((candidate) => String(candidate.header.id) === targetId)

  if (record === undefined) {
    return {
      messageable: false,
      wasLive: false,
      rejection: {
        ok: false,
        targetSessionId: targetId,
        code: 'not-found',
        reason:
          `no session with id "${targetId}" exists in this deployment's session corpus. ` +
          `Use sessions_list to find a valid id.`,
      },
    }
  }

  if (record.header.parentSession !== undefined || record.header.origin !== undefined) {
    return {
      messageable: false,
      wasLive: record.live,
      rejection: {
        ok: false,
        targetSessionId: targetId,
        code: 'not-messageable',
        reason:
          `"${targetId}" is a subagent session owned by ` +
          `"${String(record.header.parentSession)}". A session may only message a top-level ` +
          `session; subagent sessions are driven by the agent that owns them.`,
      },
    }
  }

  return { messageable: true, wasLive: record.live }
}

/**
 * Deliver one message into another session.
 *
 * Delivery is asynchronous by design: the call resolves when the target's inbox
 * accepts the message, never when the target finishes thinking. A reply is
 * another explicitly addressed message, not this call's result.
 *
 * @param query - the session query service, used for the pre-flight target check.
 * @param controller - the session controller, which owns resume policy and admission.
 * @param request - the framed message request.
 * @param signal - the tool call's own cancellation signal.
 * @returns a typed outcome; never throws for an expected refusal.
 */
export async function sendToSession(
  query: SessionQueryService,
  controller: SessionControllerService,
  request: SendRequest,
  signal: AbortSignal,
): Promise<SendOutcome> {
  const body = request.body.trim()
  const target = request.targetSessionId.trim()

  if (body.length === 0) {
    return {
      ok: false,
      targetSessionId: target,
      code: 'empty-body',
      reason: 'the message body is empty; nothing was delivered.',
    }
  }

  const verdict = await preflight(query, target)
  if (!verdict.messageable) return verdict.rejection

  // A cold target is refused BEFORE any resume, so declining to wake a session
  // leaves it genuinely untouched rather than resumed and then abandoned.
  if (!verdict.wasLive && !request.allowResume) {
    return {
      ok: false,
      targetSessionId: target,
      code: 'resume-disabled',
      reason:
        `"${target}" is not live, and this deployment disables waking cold sessions ` +
        `(cross-session.allowResume is false). The session was left untouched.`,
    }
  }

  // Resolve explicitly rather than letting `prompt` fail opaquely: this is the
  // step that resumes a cold session, and its refusal codes are the ones the
  // model can act on.
  try {
    const resolved = await controller.resolveAgent(target as SessionId)
    if ('error' in resolved) {
      return {
        ok: false,
        targetSessionId: target,
        code: resolved.error.code === 'session/not-found' ? 'not-found' : 'rejected',
        reason: resolved.error.message,
      }
    }
  } catch (error) {
    return {
      ok: false,
      targetSessionId: target,
      code: 'rejected',
      reason: `the target session could not be resolved: ${String(error)}`,
    }
  }

  const resumed = !verdict.wasLive
  const clipped = clip(body, request.maxChars)
  const framed = frameMessage(request, clipped)

  try {
    await controller.prompt(
      {
        requestId: nextRequestId(),
        sessionId: target as SessionId,
        mode: request.mode,
        content: [{ type: 'text', text: framed }],
      },
      signal,
    )
  } catch (error) {
    return {
      ok: false,
      targetSessionId: target,
      code: 'rejected',
      reason: `the target session rejected the message: ${String(error)}`,
    }
  }

  return {
    ok: true,
    targetSessionId: target,
    mode: request.mode,
    resumed,
    deliveredChars: framed.length,
  }
}

/** Render one delivery outcome as the model-facing text block. */
export function renderSendOutcome(outcome: SendOutcome): string {
  if (!outcome.ok) {
    return `NOT delivered to ${outcome.targetSessionId} (${outcome.code}): ${outcome.reason}`
  }
  const woke = outcome.resumed ? ' (woke a cold session)' : ''
  return (
    `accepted for ${outcome.targetSessionId} | mode=${outcome.mode} | ` +
    `chars=${String(outcome.deliveredChars)}${woke}\n` +
    `The message is queued in that session's inbox. Its reply will not return through ` +
    `this call; read it later with sessions_read.`
  )
}
