import type { SessionId } from '@deepseek-ai/dsh-brand'
import type { SessionQueryService, SessionRecord } from '@deepseek-ai/dsh-session-query'

import { clip } from '../shared/events.ts'

/** How a session is related to the whole corpus. */
export type SessionKind = 'top-level' | 'subagent'

/** One session as the model sees it in a listing. */
export interface SessionSummary {
  readonly sessionId: string
  readonly kind: SessionKind
  readonly live: boolean
  readonly persisted: boolean
  readonly title: string
  readonly cwd?: string
  readonly agentPreset?: string
  readonly createdAt: number
  readonly isSelf: boolean
}

export interface ListRequest {
  readonly callerId: string
  /** Free-text filter over durable ids, workspace paths, and folded titles. */
  readonly query: string
  /** Which sessions to consider. Defaults to top-level only. */
  readonly scope: 'top-level' | 'subagents' | 'all'
  /** Restrict to sessions that are live right now. */
  readonly liveOnly: boolean
  /** Maximum rows to return; already clamped by the caller's settings. */
  readonly limit: number
}

export interface ListResult {
  readonly sessions: readonly SessionSummary[]
  readonly totalConsidered: number
  readonly truncated: boolean
  /** Set when the deployment composes no search index, so `query` was matched locally. */
  readonly searchNote?: string
}

function kindOf(record: SessionRecord): SessionKind {
  return record.header.origin === 'subagent' ? 'subagent' : 'top-level'
}

/**
 * Whether a session can receive a delivered message.
 *
 * Only top-level sessions are addressable: the session controller refuses to
 * resolve a subagent-backed session for prompt admission because those belong
 * to the subagent that owns them. A subagent session that is a *continuable
 * child* is reachable through `send_message` instead, not through this plugin.
 */
export function isMessageable(record: SessionRecord): boolean {
  const { header } = record
  return header.parentSession === undefined && header.origin === undefined
}

function matchesQuery(summary: SessionSummary, needle: string): boolean {
  if (needle.length === 0) return true
  const haystack = [summary.sessionId, summary.title, summary.cwd ?? '', summary.agentPreset ?? '']
  return haystack.some((field) => field.toLowerCase().includes(needle))
}

/**
 * List sessions from the durable corpus plus the live registry.
 *
 * Titles are folded in one batch because a title is a log-derived value, not a
 * header field: asking per session would turn one listing into N log reads.
 *
 * @param query - the session query service, already resolved by the caller.
 * @param request - the caller's identity and filters.
 * @param titles - batched title observations, index-aligned with `records`.
 * @param records - the raw corpus listing this call should project.
 * @returns the projected, ranked summaries plus what was filtered out.
 */
export function projectSessions(
  request: ListRequest,
  records: readonly SessionRecord[],
  titles: readonly (string | undefined)[],
): ListResult {
  const needle = request.query.trim().toLowerCase()

  const summaries: SessionSummary[] = records.map((record, index) => {
    const kind = kindOf(record)
    const title = titles[index]
    return {
      sessionId: String(record.header.id),
      kind,
      live: record.live,
      persisted: record.persisted,
      title: title !== undefined && title.length > 0 ? title : '(untitled)',
      ...(record.header.cwd === undefined ? {} : { cwd: record.header.cwd }),
      ...(record.header.agentPreset === undefined
        ? {}
        : { agentPreset: record.header.agentPreset }),
      createdAt: record.header.createdAt,
      isSelf: String(record.header.id) === request.callerId,
    }
  })

  const scoped = summaries.filter((summary) => {
    if (request.scope === 'top-level') return summary.kind === 'top-level'
    if (request.scope === 'subagents') return summary.kind === 'subagent'
    return true
  })

  const filtered = scoped.filter((summary) => {
    if (request.liveOnly && !summary.live) return false
    return matchesQuery(summary, needle)
  })

  // Newest first, with the caller's own session last so a model reading the
  // list sees the peers it can act on before itself.
  const sorted = [...filtered].sort((left, right) => {
    if (left.isSelf !== right.isSelf) return left.isSelf ? 1 : -1
    return right.createdAt - left.createdAt
  })

  const limited = sorted.slice(0, request.limit)

  return {
    sessions: limited,
    totalConsidered: scoped.length,
    truncated: sorted.length > limited.length,
  }
}

/**
 * Read the whole corpus and fold titles for the listed rows.
 *
 * @param query - the session query service.
 * @param request - the caller's filters.
 * @param signal - caller cancellation, forwarded to every backend read.
 * @returns the projected listing.
 */
export async function listSessions(
  query: SessionQueryService,
  request: ListRequest,
  signal: AbortSignal,
): Promise<ListResult> {
  const records = await query.listSessions(signal)

  // Only the rows that survive the cheap filters need a title read.
  const prefiltered = records.filter((record) => {
    if (record.header.origin === 'subagent' && request.scope === 'top-level') return false
    if (record.header.origin !== 'subagent' && request.scope === 'subagents') return false
    if (request.liveOnly && !record.live) return false
    return true
  })

  const observations = await query.readTitleSnapshots(
    prefiltered.map((record) => record.header.id),
    signal,
  )

  const titles = observations.map((observation) =>
    observation.status === 'fulfilled' ? observation.value.title : undefined,
  )

  // `projectSessions` re-applies every filter; the prefilter above exists only
  // to keep the title batch small, so both must agree on scope and liveness.
  return projectSessions(request, prefiltered, titles)
}

/** Render one summary as a single stable line. */
export function renderSummary(summary: SessionSummary): string {
  const flags = [summary.live ? 'live' : 'cold', summary.kind]
  if (summary.isSelf) flags.push('this session')
  const where = summary.cwd === undefined ? '' : ` | cwd=${clip(summary.cwd, 48)}`
  const preset = summary.agentPreset === undefined ? '' : ` | preset=${summary.agentPreset}`
  const unreadable = isSummaryMessageable(summary) ? '' : ' | not messageable'
  return `- ${summary.sessionId} [${flags.join(', ')}]${where}${preset}${unreadable}\n    ${clip(
    summary.title,
    100,
  )}`
}

/** Whether a projected summary can receive a message (mirrors {@link isMessageable}). */
export function isSummaryMessageable(summary: SessionSummary): boolean {
  return summary.kind === 'top-level'
}

/** Convenience for tests and callers that hold an id but not a record. */
export function asSessionId(value: string): SessionId {
  return value as SessionId
}
