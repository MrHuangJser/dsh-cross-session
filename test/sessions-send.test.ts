import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PromptDeliveryMode } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'

import { type SendRequest, frameMessage, sendToSession } from '../src/host/sessions-send.ts'

/** One session as the fake corpus stores it. */
interface FakeSession {
  readonly id: string
  readonly live: boolean
  readonly parentSession?: string
  readonly origin?: 'subagent'
}

/** Build a minimal `sessionQuery` stand-in exposing only `listSessions`. */
function fakeQuery(sessions: readonly FakeSession[]): SessionQueryService {
  return {
    listSessions: async () =>
      Promise.resolve(
        sessions.map((session) => ({
          header: {
            id: session.id,
            createdAt: 0,
            isSeeded: false,
            ...(session.parentSession === undefined
              ? {}
              : { parentSession: session.parentSession }),
            ...(session.origin === undefined ? {} : { origin: session.origin }),
          },
          live: session.live,
          persisted: true,
        })),
      ),
  } as unknown as SessionQueryService
}

interface PromptCall {
  readonly sessionId: string
  readonly mode: PromptDeliveryMode
  readonly text: string
}

/** Build a `sessionController` stand-in that records what it was asked to admit. */
function fakeController(calls: PromptCall[]): {
  resolveAgent: (id: string) => Promise<unknown>
  prompt: (request: unknown) => Promise<{ accepted: true }>
} {
  return {
    resolveAgent: async (id: string) => Promise.resolve({ agent: { id } }),
    prompt: async (request: unknown) => {
      const typed = request as {
        sessionId: string
        mode: PromptDeliveryMode
        content: { text: string }[]
      }
      calls.push({
        sessionId: typed.sessionId,
        mode: typed.mode,
        text: typed.content[0]?.text ?? '',
      })
      return Promise.resolve({ accepted: true as const })
    },
  }
}

function requestOf(overrides: Partial<SendRequest> = {}): SendRequest {
  return {
    sender: { sessionId: 'session-sender', title: 'Sender' },
    targetSessionId: 'session-target',
    body: 'please run the tests',
    mode: 'queue',
    allowResume: true,
    frame: true,
    maxChars: 4000,
    ...overrides,
  }
}

describe('frameMessage', () => {
  it('names the sending session so the receiver can reply', () => {
    const framed = frameMessage(requestOf(), 'body text')
    assert.match(framed, /from-session: session-sender \("Sender"\)/)
    assert.match(framed, /delivery: queue/)
    assert.match(framed, /--- message begins ---\nbody text\n--- message ends ---/)
  })

  it('omits the title when the sender has none', () => {
    const framed = frameMessage(requestOf({ sender: { sessionId: 'session-x' } }), 'body')
    assert.match(framed, /from-session: session-x\n/)
  })

  it('returns the body untouched when framing is off', () => {
    assert.equal(frameMessage(requestOf({ frame: false }), 'body'), 'body')
  })
})

describe('sendToSession', () => {
  it('delivers to a live top-level session and reports it as not resumed', async () => {
    const calls: PromptCall[] = []
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-target', live: true }]),
      fakeController(calls) as never,
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.sessionId, 'session-target')
    assert.equal(calls[0]?.mode, 'queue')
    assert.match(calls[0]?.text ?? '', /please run the tests/)
    if (outcome.ok) assert.equal(outcome.resumed, false)
  })

  it('reports a cold target as resumed', async () => {
    const calls: PromptCall[] = []
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-target', live: false }]),
      fakeController(calls) as never,
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, true)
    if (outcome.ok) assert.equal(outcome.resumed, true)
    assert.equal(calls.length, 1)
  })

  it('refuses a cold target before waking it when resume is disabled', async () => {
    const calls: PromptCall[] = []
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-target', live: false }]),
      fakeController(calls) as never,
      requestOf({ allowResume: false }),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.code, 'resume-disabled')
    // The critical assertion: nothing was admitted, so nothing was woken.
    assert.equal(calls.length, 0)
  })

  it('refuses an unknown session without admitting anything', async () => {
    const calls: PromptCall[] = []
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-other', live: true }]),
      fakeController(calls) as never,
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.code, 'not-found')
    assert.equal(calls.length, 0)
  })

  it('refuses a subagent session and names its owner', async () => {
    const calls: PromptCall[] = []
    const outcome = await sendToSession(
      fakeQuery([
        { id: 'session-target', live: true, parentSession: 'session-owner', origin: 'subagent' },
      ]),
      fakeController(calls) as never,
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, false)
    if (!outcome.ok) {
      assert.equal(outcome.code, 'not-messageable')
      assert.match(outcome.reason, /session-owner/)
    }
    assert.equal(calls.length, 0)
  })

  it('refuses an empty body', async () => {
    const calls: PromptCall[] = []
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-target', live: true }]),
      fakeController(calls) as never,
      requestOf({ body: '   ' }),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.code, 'empty-body')
    assert.equal(calls.length, 0)
  })

  it('reports a controller rejection instead of throwing', async () => {
    const controller = {
      resolveAgent: async (id: string) => Promise.resolve({ agent: { id } }),
      prompt: async () => Promise.reject(new Error('session/agent-busy')),
    }
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-target', live: true }]),
      controller as never,
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, false)
    if (!outcome.ok) {
      assert.equal(outcome.code, 'rejected')
      assert.match(outcome.reason, /agent-busy/)
    }
  })

  it('reports a resolve failure as a refusal', async () => {
    const controller = {
      resolveAgent: async () =>
        Promise.resolve({ error: { code: 'session/not-found', message: 'gone' } }),
      prompt: async () => Promise.resolve({ accepted: true as const }),
    }
    const outcome = await sendToSession(
      fakeQuery([{ id: 'session-target', live: true }]),
      controller as never,
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.code, 'not-found')
  })
})
