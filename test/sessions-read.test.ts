import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session'

import { type ReadRequest, readSession, renderTranscript } from '../src/host/sessions-read.ts'

/** Build a `sessionQuery` stand-in exposing the two reads the reader performs. */
function fakeQuery(surface: Partial<SessionSurfaceSnapshot>, title?: string): SessionQueryService {
  return {
    readTitle: async () =>
      Promise.resolve(title === undefined ? undefined : { title, eventSeq: 1, updatedAt: 0 }),
    readSurface: async () =>
      Promise.resolve({
        session: { id: 'session-target', createdAt: 0, isSeeded: false },
        inheritedEventCount: 0,
        capturedThroughSeq: 99,
        events: [],
        ...surface,
      }),
  } as unknown as SessionQueryService
}

function requestOf(overrides: Partial<ReadRequest> = {}): ReadRequest {
  return {
    sessionId: 'session-target',
    maxMessages: 12,
    maxChars: 1200,
    includeInjected: false,
    includeSystem: false,
    ...overrides,
  }
}

const USER_EVENT = {
  type: 'user/message',
  seq: 5,
  time: 0,
  data: {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: 'run the tests' }],
    source: { kind: 'user' },
  },
}

const ASSISTANT_EVENT = {
  type: 'assistant/message',
  seq: 9,
  time: 0,
  data: {
    turn: 1,
    step: 1,
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'private scratchpad' },
        { type: 'text', text: 'all green' },
      ],
      source: { kind: 'model', provider: 'p', model: 'm' },
    },
  },
}

const INJECTED_EVENT = {
  type: 'user/message',
  seq: 6,
  time: 0,
  data: {
    id: 'm2',
    role: 'user',
    content: [{ type: 'text', text: '<system-reminder>\nA skill you might use' }],
    source: { kind: 'plugin', plugin: 'dsh-agent-instructions', form: 'instructions' },
  },
}

const SYSTEM_EVENT = {
  type: 'system/message',
  seq: 7,
  time: 0,
  data: {
    turn: 1,
    step: 1,
    message: {
      role: 'system',
      content: [{ type: 'text', text: 'notice' }],
      source: { kind: 'plugin', plugin: 'x' },
    },
  },
}

const TOOL_EVENT = {
  type: 'tool/result',
  seq: 8,
  time: 0,
  data: {
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'tool output' }],
      source: { kind: 'tool', callId: 'c1' },
    },
  },
}

describe('readSession', () => {
  it('reads both message shapes and drops reasoning and tool output', async () => {
    const transcript = await readSession(
      fakeQuery({ events: [USER_EVENT, ASSISTANT_EVENT, TOOL_EVENT] } as never, 'Target'),
      requestOf(),
      new AbortController().signal,
    )

    assert.equal(transcript.title, 'Target')
    assert.deepEqual(
      transcript.items.map((item) => [item.role, item.text]),
      [
        ['user', 'run the tests'],
        ['assistant', 'all green'],
      ],
    )
  })

  it('hides harness-injected context by default and can include it on request', async () => {
    const hidden = await readSession(
      fakeQuery({ events: [INJECTED_EVENT, USER_EVENT] } as never),
      requestOf(),
      new AbortController().signal,
    )
    assert.deepEqual(
      hidden.items.map((item) => item.text),
      ['run the tests'],
    )

    const shown = await readSession(
      fakeQuery({ events: [INJECTED_EVENT, USER_EVENT] } as never),
      requestOf({ includeInjected: true }),
      new AbortController().signal,
    )
    assert.equal(shown.items.length, 2)
    assert.equal(shown.items[0]?.injected, true)
  })

  it('hides system notices unless asked, and marks them when shown', async () => {
    const hidden = await readSession(
      fakeQuery({ events: [SYSTEM_EVENT] } as never),
      requestOf(),
      new AbortController().signal,
    )
    assert.equal(hidden.items.length, 0)

    const shown = await readSession(
      fakeQuery({ events: [SYSTEM_EVENT] } as never),
      requestOf({ includeSystem: true }),
      new AbortController().signal,
    )
    assert.equal(shown.items[0]?.role, 'system')
    assert.equal(shown.items[0]?.source, 'plugin:x')
  })

  it('keeps the newest window and counts what it dropped', async () => {
    const events = [1, 2, 3, 4, 5].map((index) => ({
      type: 'user/message',
      seq: index,
      time: 0,
      data: {
        id: `m${index}`,
        role: 'user',
        content: [{ type: 'text', text: `msg ${index}` }],
        source: { kind: 'user' },
      },
    }))

    const transcript = await readSession(
      fakeQuery({ events } as never),
      requestOf({ maxMessages: 2 }),
      new AbortController().signal,
    )

    assert.deepEqual(
      transcript.items.map((item) => item.text),
      ['msg 4', 'msg 5'],
    )
    assert.equal(transcript.total, 5)
    assert.equal(transcript.omitted, 3)
  })

  it('marks a message that a later event replaced', async () => {
    const replaced = {
      type: 'assistant/message',
      seq: 4,
      time: 0,
      surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 },
      data: ASSISTANT_EVENT.data,
    }
    const transcript = await readSession(
      fakeQuery({ events: [replaced] } as never),
      requestOf(),
      new AbortController().signal,
    )
    assert.equal(transcript.items[0]?.replaced, true)
  })

  it('reports a subagent session as such', async () => {
    const transcript = await readSession(
      fakeQuery({
        session: { id: 'agent-child', createdAt: 0, isSeeded: false, origin: 'subagent' },
      } as never),
      requestOf(),
      new AbortController().signal,
    )
    assert.equal(transcript.kind, 'subagent')
  })
})

describe('renderTranscript', () => {
  it('renders a header, provenance marks, and an omission footer', async () => {
    const transcript = await readSession(
      fakeQuery({ events: [USER_EVENT, ASSISTANT_EVENT] } as never, 'Target'),
      requestOf({ maxMessages: 1 }),
      new AbortController().signal,
    )
    const rendered = renderTranscript(transcript)

    assert.match(rendered, /session session-target \[live, top-level\]/)
    assert.match(rendered, /title: Target/)
    assert.match(rendered, /readable messages: 2/)
    assert.match(rendered, /--- assistant \(seq 9, model:p\/m\) ---/)
    assert.match(rendered, /\(1 earlier messages omitted\)/)
  })

  it('says so when there is nothing readable', async () => {
    const transcript = await readSession(
      fakeQuery({ events: [] } as never),
      requestOf(),
      new AbortController().signal,
    )
    assert.match(renderTranscript(transcript), /\(no readable conversation in this session\)/)
  })
})
