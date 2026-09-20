import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

import {
  type ListRequest,
  isMessageable,
  isSummaryMessageable,
  projectSessions,
  renderSummary,
} from '../src/host/sessions-list.ts'

/**
 * Build one corpus record.
 *
 * `overrides` is a loose record on purpose: session headers carry branded id
 * types that a readable test fixture should not have to brand by hand.
 */
function record(
  id: string,
  overrides: Record<string, unknown> = {},
  flags: { live?: boolean } = {},
): SessionRecord {
  return {
    header: { id, createdAt: 0, isSeeded: false, ...overrides },
    live: flags.live ?? true,
    persisted: true,
  } as unknown as SessionRecord
}

function requestOf(overrides: Partial<ListRequest> = {}): ListRequest {
  return {
    callerId: 'session-caller',
    query: '',
    scope: 'top-level',
    liveOnly: false,
    limit: 25,
    ...overrides,
  }
}

describe('projectSessions', () => {
  it('sorts newest first but always puts the calling session last', () => {
    const records = [
      record('session-caller', { createdAt: 9_000 }),
      record('session-old', { createdAt: 100 }),
      record('session-new', { createdAt: 5_000 }),
    ]
    const result = projectSessions(requestOf(), records, [undefined, undefined, undefined])
    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ['session-new', 'session-old', 'session-caller'],
    )
    assert.equal(result.sessions[2]?.isSelf, true)
  })

  it('filters subagent sessions out of the default scope', () => {
    const records = [
      record('session-top'),
      record('agent-child', { parentSession: 'session-top', origin: 'subagent' }),
    ]
    const topLevel = projectSessions(requestOf(), records, [undefined, undefined])
    assert.deepEqual(
      topLevel.sessions.map((session) => session.sessionId),
      ['session-top'],
    )

    const subagents = projectSessions(requestOf({ scope: 'subagents' }), records, [
      undefined,
      undefined,
    ])
    assert.deepEqual(
      subagents.sessions.map((session) => session.sessionId),
      ['agent-child'],
    )
    assert.equal(subagents.sessions[0]?.kind, 'subagent')
  })

  it('matches the free-text query against id, title, and cwd', () => {
    const records = [
      record('session-alpha', { cwd: '/work/api' }),
      record('session-beta', { cwd: '/work/web' }),
    ]
    const titles = ['Fix the parser', 'Tune the dashboard']

    assert.deepEqual(
      projectSessions(requestOf({ query: 'PARSER' }), records, titles).sessions.map(
        (s) => s.sessionId,
      ),
      ['session-alpha'],
    )
    assert.deepEqual(
      projectSessions(requestOf({ query: 'beta' }), records, titles).sessions.map(
        (s) => s.sessionId,
      ),
      ['session-beta'],
    )
    assert.deepEqual(
      projectSessions(requestOf({ query: '/work/web' }), records, titles).sessions.map(
        (s) => s.sessionId,
      ),
      ['session-beta'],
    )
    assert.equal(
      projectSessions(requestOf({ query: 'nothing-matches' }), records, titles).sessions.length,
      0,
    )
  })

  it('respects liveOnly and the limit, and reports truncation', () => {
    const records = [
      record('session-a', { createdAt: 3 }, { live: true }),
      record('session-b', { createdAt: 2 }, { live: false }),
      record('session-c', { createdAt: 1 }, { live: true }),
    ]

    const live = projectSessions(requestOf({ liveOnly: true }), records, [
      undefined,
      undefined,
      undefined,
    ])
    assert.equal(live.sessions.length, 2)

    const limited = projectSessions(requestOf({ limit: 2 }), records, [
      undefined,
      undefined,
      undefined,
    ])
    assert.equal(limited.sessions.length, 2)
    assert.equal(limited.truncated, true)
    assert.equal(limited.totalConsidered, 3)

    const all = projectSessions(requestOf(), records, [undefined, undefined, undefined])
    assert.equal(all.truncated, false)
  })

  it('falls back to "(untitled)" when a folded title is absent', () => {
    const result = projectSessions(requestOf(), [record('session-a')], [undefined])
    assert.equal(result.sessions[0]?.title, '(untitled)')
  })
})

describe('messageability', () => {
  it('accepts a top-level session and rejects a subagent session', () => {
    assert.equal(isMessageable(record('session-top')), true)
    assert.equal(
      isMessageable(record('agent-child', { parentSession: 'session-top', origin: 'subagent' })),
      false,
    )
    assert.equal(isSummaryMessageable({ kind: 'top-level' } as never), true)
    assert.equal(isSummaryMessageable({ kind: 'subagent' } as never), false)
  })
})

describe('renderSummary', () => {
  it('flags liveness, kind, and this-session, and marks subagents unmessageable', () => {
    const live = renderSummary({
      sessionId: 'session-a',
      kind: 'top-level',
      live: true,
      persisted: true,
      title: 'Alpha',
      createdAt: 0,
      isSelf: false,
    })
    assert.match(live, /session-a \[live, top-level\]/)
    assert.doesNotMatch(live, /not messageable/)

    const self = renderSummary({
      sessionId: 'session-b',
      kind: 'top-level',
      live: false,
      persisted: true,
      title: 'Beta',
      createdAt: 0,
      isSelf: true,
    })
    assert.match(self, /\[cold, top-level, this session\]/)

    const child = renderSummary({
      sessionId: 'agent-c',
      kind: 'subagent',
      live: true,
      persisted: true,
      title: 'Child',
      createdAt: 0,
      isSelf: false,
    })
    assert.match(child, /not messageable/)
  })
})
