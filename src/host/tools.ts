import type { JsonValue } from '@deepseek-ai/cordis'
import type { Agent, AgentsService } from '@deepseek-ai/dsh-agent'
import type { PromptDeliveryMode } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'
import type { SessionControllerService } from '@deepseek-ai/dsh-api-session-controller'
import type { Disposer, ToolDefinition, ToolsService } from '@deepseek-ai/dsh-tools'

import { TOOL_LIST, TOOL_READ, TOOL_SEND } from '../shared/meta.ts'
import { type CrossSessionSettings, normalizeSendMode } from '../shared/settings.ts'
import { type ListRequest, listSessions, renderSummary } from './sessions-list.ts'
import { type ReadRequest, readSession, renderTranscript } from './sessions-read.ts'
import { type SendRequest, renderSendOutcome, sendToSession } from './sessions-send.ts'

/**
 * The tool layer.
 *
 * Every tool follows the same three-step shape: read a frozen argument record,
 * narrow it into a typed request, delegate to a pure-ish module that owns the
 * behaviour. Argument validation never throws — a model calling a tool with a
 * bad argument gets a readable refusal, not a stack trace, because a thrown
 * error teaches the model nothing about how to correct itself.
 */

/** JSON Schema fragment for one string property. */
function stringProp(description: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type: 'string', description, ...extra }
}

/** JSON Schema fragment for one boolean property. */
function booleanProp(description: string): Record<string, unknown> {
  return { type: 'boolean', description }
}

/** JSON Schema fragment for one integer property. */
function intProp(description: string, min: number, max: number): Record<string, unknown> {
  return { type: 'integer', description, minimum: min, maximum: max }
}

/** Read a frozen argument record without trusting its shape. */
function argsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Read one string argument, or the fallback when absent or not a string. */
function stringArg(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key]
  return typeof value === 'string' ? value : fallback
}

/** Read one boolean argument, or the fallback when absent or not a boolean. */
function booleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key]
  return typeof value === 'boolean' ? value : fallback
}

/** Read one integer argument, clamped into range, or the fallback. */
function intArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** The text-block content a tool renders. */
function text(value: string): JsonValue {
  return value
}

/** Declare a text-valued output so the registry can validate the canonical value. */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: JsonValue): { type: 'text'; text: string }[] => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ],
}

/** Everything a tool body needs that does not change between calls. */
export interface ToolContext {
  readonly query: SessionQueryService
  readonly controller: SessionControllerService
  readonly agents: AgentsService
  readonly settings: () => CrossSessionSettings
}

/**
 * Resolve the calling session's identity.
 *
 * `exec.agent` is authoritative: it is the exact live Agent the registry
 * dispatched the call for, and it is what a cross-session call presents as its
 * authority credential. It is declared optional because a nested dispatch is
 * not guaranteed to carry one, and the live registry is the documented
 * fallback for that case.
 */
function callerIdentity(
  exec: { readonly agent?: Agent },
  agents: AgentsService,
): Agent | undefined {
  if (exec.agent !== undefined) return exec.agent
  return agents.currentInitiator()
}

function defineListTool(context: ToolContext): ToolDefinition {
  return {
    name: TOOL_LIST,
    description:
      'List the other sessions of this harness, newest first, with their durable id, ' +
      'title, workspace, and whether they are currently live. Use this to find the id ' +
      'of a session to read or message; ids are the only accepted address.',
    parameters: {
      type: 'object',
      properties: {
        query: stringProp(
          'Case-insensitive filter over session ids, titles, and workspace paths. ' +
            'Empty string lists the most recent sessions.',
        ),
        scope: stringProp('Which sessions to list. Defaults to top-level.', {
          enum: ['top-level', 'subagents', 'all'],
        }),
        live_only: booleanProp('Restrict the listing to sessions that are live right now.'),
        limit: intProp('Maximum rows to return.', 1, 200),
      },
      required: [],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (rawArgs, exec): Promise<JsonValue> => {
      const settings = context.settings()
      const args = argsOf(rawArgs)
      const caller = callerIdentity(exec, context.agents)
      if (caller === undefined) {
        return text('Cannot list sessions: this call has no resolvable calling session identity.')
      }

      const scopeRaw = stringArg(args, 'scope', 'top-level')
      const scope: ListRequest['scope'] =
        scopeRaw === 'subagents' || scopeRaw === 'all' ? scopeRaw : 'top-level'

      const request: ListRequest = {
        callerId: String(caller.id),
        query: stringArg(args, 'query'),
        scope,
        liveOnly: booleanArg(args, 'live_only', false),
        limit: intArg(args, 'limit', settings.maxListResults, 1, settings.maxListResults),
      }

      try {
        const result = await listSessions(context.query, request, exec.signal)
        const lines = result.sessions.map((summary) => renderSummary(summary))
        if (lines.length === 0) {
          return text(
            `(no matching session; ${String(result.totalConsidered)} sessions were considered)`,
          )
        }
        const footer =
          `\n\n${String(result.sessions.length)} of ${String(result.totalConsidered)} considered sessions` +
          (result.truncated ? ' (more matched than the limit)' : '') +
          `\nTop-level sessions are messageable with ${TOOL_SEND}; subagent sessions are not.`
        return text(`${lines.join('\n')}${footer}`)
      } catch (error) {
        return text(`Listing sessions failed: ${String(error)}`)
      }
    },
  }
}

function defineReadTool(context: ToolContext): ToolDefinition {
  return {
    name: TOOL_READ,
    description:
      "Read a bounded, text-only window of another session's current conversation. " +
      "Returns that session's most recent user and assistant messages, not its full " +
      'transcript, and never its tool output or reasoning.',
    parameters: {
      type: 'object',
      properties: {
        session_id: stringProp('Durable session id, as returned by sessions_list.'),
        max_messages: intProp('How many of the most recent messages to include.', 1, 100),
        include_injected: booleanProp(
          'Include harness-injected context (system reminders, memory snapshots). ' +
            'Off by default because it is not what the session actually discussed.',
        ),
        include_system: booleanProp('Include plugin-authored system notices. Off by default.'),
      },
      required: ['session_id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (rawArgs, exec): Promise<JsonValue> => {
      const settings = context.settings()
      const args = argsOf(rawArgs)
      const sessionId = stringArg(args, 'session_id').trim()
      if (sessionId.length === 0) {
        return text('Reading a session requires its durable session_id.')
      }

      const request: ReadRequest = {
        sessionId,
        maxMessages: intArg(
          args,
          'max_messages',
          settings.maxReadMessages,
          1,
          settings.maxReadMessages,
        ),
        maxChars: settings.maxMessageChars,
        includeInjected: booleanArg(args, 'include_injected', settings.includeInjectedByDefault),
        includeSystem: booleanArg(args, 'include_system', false),
      }

      try {
        const transcript = await readSession(context.query, request, exec.signal)
        return text(renderTranscript(transcript))
      } catch (error) {
        return text(
          `Reading session "${sessionId}" failed: ${String(error)}. ` +
            `Verify the id with ${TOOL_LIST}.`,
        )
      }
    },
  }
}

function defineSendTool(context: ToolContext): ToolDefinition {
  return {
    name: TOOL_SEND,
    description:
      'Send a message into another top-level session of this harness. Use it to hand work ' +
      'to a peer session or to ask one a question. Delivery is asynchronous: the call ' +
      'returns when the target accepts the message, never with a reply — read the answer ' +
      'later with ' +
      TOOL_READ +
      '. A subagent session cannot be addressed this way.',
    parameters: {
      type: 'object',
      properties: {
        session_id: stringProp('Durable id of the target session, as returned by sessions_list.'),
        message: stringProp('The message body to deliver.'),
        mode: stringProp(
          "queue delivers the message as the target's next turn (default). " +
            'steer inserts it into the turn the target is running now.',
          { enum: ['queue', 'steer'] },
        ),
      },
      required: ['session_id', 'message'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (rawArgs, exec): Promise<JsonValue> => {
      const settings = context.settings()
      const args = argsOf(rawArgs)
      const targetSessionId = stringArg(args, 'session_id').trim()
      if (targetSessionId.length === 0) {
        return text('Sending requires the target session_id.')
      }

      const caller = callerIdentity(exec, context.agents)
      const callerId = caller === undefined ? 'unknown' : String(caller.id)
      const mode: PromptDeliveryMode = normalizeSendMode(
        stringArg(args, 'mode', settings.defaultSendMode),
      )

      // The sender's folded title goes into the frame when one exists, so the
      // receiver sees a name, not just an id. A missing title is not an error.
      let senderTitle: string | undefined
      try {
        senderTitle = (await context.query.readTitle(callerId as never))?.title
      } catch {
        senderTitle = undefined
      }

      const request: SendRequest = {
        sender:
          senderTitle === undefined
            ? { sessionId: callerId }
            : { sessionId: callerId, title: senderTitle },
        targetSessionId,
        body: stringArg(args, 'message'),
        mode,
        allowResume: settings.allowResume,
        frame: settings.frameMessages,
        maxChars: settings.maxSendChars,
      }

      const outcome = await sendToSession(context.query, context.controller, request, exec.signal)
      return text(renderSendOutcome(outcome))
    },
  }
}

/**
 * Register every tool this plugin contributes.
 *
 * @param ctx - the plugin context, which owns the registration lifetime.
 * @param tools - the Host tool registry.
 * @param context - the resolved services and settings accessor for tool bodies.
 * @returns one disposer that unregisters all three tools.
 */
export function registerTools(
  ctx: { effect(callback: () => Disposer, label?: string): Disposer },
  tools: ToolsService,
  context: ToolContext,
): Disposer {
  const definitions = [defineListTool(context), defineReadTool(context), defineSendTool(context)]

  return ctx.effect(() => {
    const disposers = definitions.map((definition) => tools.register(definition))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, '@huangjiangheng/dsh-cross-session: tools')
}

export { TOOL_LIST, TOOL_READ, TOOL_SEND }
