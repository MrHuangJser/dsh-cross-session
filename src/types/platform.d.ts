/**
 * Hand-written declarations for the DSH / Cordis surface this plugin binds to.
 *
 * Why these are local instead of imported from `@deepseek-ai/*`:
 *
 * 1. The published `@deepseek-ai/dsh-*` SDK packages on npm trail the runtime
 *    this plugin targets (npm carries `0.0.1-rc.*` / `0.1.0-rc.*` while the
 *    running harness is on `0.1.5-rc.2`), and the session/agent surfaces below
 *    changed between those lines.
 * 2. The harness resolves plugins by package at load time; peer-importing
 *    `@deepseek-ai/*` would make the installed plugin refuse to load against a
 *    runtime whose version string it does not recognise.
 * 3. The binding is deliberately narrow: only the methods this plugin calls are
 *    declared, so a runtime change to anything else cannot break the build.
 *
 * Every declaration here was read from the running harness's own type
 * declarations (`node_modules/@deepseek-ai/*/ lib / types /*.d.ts`) and from live
 * Inspect queries. The exact runtime version this was verified against is
 * recorded in README.md under "Compatibility".
 *
 * These are `declare module` declarations: they describe the *provider*, not
 * this package. No `@deepseek-ai/*` dependency is required or resolved.
 */

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/cordis — the plugin runtime
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/cordis' {
  /** Disposes one registered contribution. Idempotent. */
  export type Disposer = () => void

  /** JSON value as the harness defines it (no `undefined` member). */
  export type JsonValue =
    null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

  /** Structured logger made available to every plugin context. */
  export interface Logger {
    debug(...values: unknown[]): void
    info(...values: unknown[]): void
    warn(...values: unknown[]): void
    error(...values: unknown[]): void
  }

  /** Disposable timer helpers mixed into every Cordis context. */
  export interface TimerService {
    timeout(callback: () => void, delay: number): Disposer
    timeout(delay: number): Promise<void>
    interval(callback: () => void, delay: number): Disposer
    throttle<F extends (...args: never[]) => void>(callback: F, delay: number): F & Disposer
    debounce<F extends (...args: never[]) => void>(callback: F, delay: number): F & Disposer
  }

  /**
   * The service table a plugin reaches through `ctx`.
   *
   * Only the keys this plugin actually consumes are declared, and each one is
   * optional at the type level: a preset decides which of them this deployment
   * composes. Runtime presence is resolved through `ctx.get(name)` with an
   * explicit `undefined` check, which is why every consumer here can degrade to
   * a typed error instead of throwing.
   */
  export interface Context {
    readonly logger: Logger
    readonly timer: TimerService

    /** Cordis service resolution. Prefer this over property access for optional services. */
    get(name: string): unknown

    /** Subscribe to one lifecycle event. Returns the disposer. */
    on(name: string, listener: (...args: never[]) => void): Disposer

    /**
     * Run a side effect owned by this plugin's fiber.
     *
     * The callback returns the disposer that undoes what it registered; the
     * returned disposer undoes the whole effect, including any cleanup the
     * callback already handed back.
     */
    effect(callback: () => Disposer, label?: string): Disposer

    /** Register a service provided by this plugin. */
    provide(name: string, value: unknown): Disposer
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-brand — branded identity strings
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-brand' {
  const BRAND: unique symbol

  export type Branded<B extends string> = string & { readonly [BRAND]: B }

  export type SessionId = Branded<'SessionId'>
  export type MessageId = Branded<'MessageId'>
  export type SessionSeq = number & { readonly [BRAND]: 'SessionSeq' }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-session — the event-sourced session log
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-session' {
  import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-brand'

  export type { SessionId, SessionSeq }

  /** Surface events are the ones that can appear in the model's current context. */
  export type SurfaceEventType =
    'system/message' | 'user/message' | 'assistant/message' | 'tool/result'

  export type SessionEventType =
    | 'turn/start'
    | 'turn/end'
    | 'step/start'
    | 'step/end'
    | SurfaceEventType
    | 'tool/call'
    | 'assistant/attempt'
    | 'request/header'
    | 'request/context'
    | 'session/end-seed'

  export interface SessionHeader {
    readonly id: SessionId
    readonly createdAt: number
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly isSeeded: boolean
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }

  /** Raw event record as the log stores it; `data` is deliberately `unknown`. */
  export interface SessionEvent<TType extends string = SessionEventType> {
    readonly type: TType
    readonly seq: SessionSeq
    readonly time: number
    readonly data: unknown
  }

  /** One session's complete current model surface, captured at one sequence. */
  export interface SessionSurfaceSnapshot {
    readonly session: SessionHeader
    readonly inheritedEventCount: number
    readonly capturedThroughSeq: SessionSeq | null
    readonly events: readonly SessionEvent<SurfaceEventType>[]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-llm — content blocks and messages
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-llm' {
  import type { MessageId } from '@deepseek-ai/dsh-brand'

  export type { MessageId }

  export interface TextBlock {
    readonly type: 'text'
    readonly text: string
  }

  /** Model-authored chain of thought. Never forwarded by this plugin. */
  export interface ReasoningBlock {
    readonly type: 'reasoning'
    readonly text: string
  }

  export interface ToolCallBlock {
    readonly type: 'tool-call'
    readonly id: string
    readonly name: string
    readonly arguments: string
  }

  export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | { readonly type: string }

  /** Durable attribution for one message. */
  export type MessageSource =
    | { readonly kind: 'user' }
    | { readonly kind: 'plugin'; readonly plugin: string; readonly form?: string }
    | { readonly kind: 'model'; readonly provider: string; readonly model: string }
    | { readonly kind: 'tool'; readonly callId: string }

  export interface Message {
    readonly id: MessageId
    readonly role: 'system' | 'user' | 'assistant'
    readonly content: readonly ContentBlock[]
    readonly source: MessageSource
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-agent — the live agent registry
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-agent' {
  import type { SessionId } from '@deepseek-ai/dsh-brand'

  /**
   * The authority credential every cross-session call carries: an exact, live
   * Agent object. Holding one is what proves the caller exists.
   */
  export interface Agent {
    readonly id: SessionId
  }

  export interface AgentsService {
    /** The Agent driving the current asynchronous chain, or `undefined` outside one. */
    currentInitiator(): Agent | undefined
    /** One live Agent by session id. */
    get(id: SessionId): Agent | undefined
    /** Every live Agent in this process. */
    list(): readonly Agent[]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-session-query — durable and live session reads
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-session-query' {
  import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-brand'
  import type {
    SessionEvent,
    SessionHeader,
    SessionSurfaceSnapshot,
  } from '@deepseek-ai/dsh-session'

  export interface SessionRecord {
    readonly header: SessionHeader
    readonly live: boolean
    readonly persisted: boolean
  }

  export interface SessionTitleSnapshot {
    readonly title: string
    readonly eventSeq: SessionSeq
    readonly updatedAt: number
  }

  export type SessionTitleObservation =
    | {
        readonly sessionId: SessionId
        readonly status: 'fulfilled'
        readonly value: SessionTitleSnapshot
      }
    | { readonly sessionId: SessionId; readonly status: 'rejected'; readonly reason: unknown }

  export interface SessionEventRecord {
    readonly sessionId: SessionId
    readonly seq: SessionSeq
    readonly type: string
    readonly time: number
    readonly surface: 'current' | 'shadowed' | 'log-only'
  }

  export interface SessionSearchHit {
    readonly header: SessionHeader
    readonly live: boolean
    readonly persisted: boolean
  }

  export interface SessionSearchPage {
    readonly items: readonly SessionSearchHit[]
    readonly nextCursor?: string
  }

  /**
   * The unified session query service. Exact reads work on any storage backend;
   * ranked full-text search additionally needs an index backend, and a
   * deployment may compose the service with that index disabled — which is why
   * the search method is treated as optional behaviour here.
   */
  export interface SessionQueryService {
    listSessions(signal?: AbortSignal): Promise<readonly SessionRecord[]>
    readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>
    readTitleSnapshots(
      sessionIds: readonly SessionId[],
      signal?: AbortSignal,
    ): Promise<readonly SessionTitleObservation[]>
    listEvents(sessionId: SessionId): Promise<readonly SessionEventRecord[]>
    readEvent(request: {
      readonly sessionId: SessionId
      readonly seq: SessionSeq
      readonly before?: number
      readonly after?: number
    }): Promise<{ readonly target: SessionEvent; readonly events: readonly SessionEvent[] }>
    readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>
    searchSessions(request: {
      readonly query: string
      readonly limit?: number
    }): Promise<SessionSearchPage>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-api-session-controller — the cross-session send path
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-api-session-controller' {
  import type { SessionId } from '@deepseek-ai/dsh-brand'
  import type { Agent } from '@deepseek-ai/dsh-agent'

  /** Where a delivered message lands relative to the target's current turn. */
  export type PromptDeliveryMode = 'queue' | 'steer'

  export interface PromptTextPart {
    readonly type: 'text'
    readonly text: string
  }

  export interface SessionPromptRequest {
    /** Correlation identity; a repeat of an already-admitted id is a no-op. */
    readonly requestId: string
    readonly sessionId: SessionId
    readonly mode: PromptDeliveryMode
    readonly content: readonly PromptTextPart[]
  }

  export type ApiSessionAgentResult =
    | { readonly agent: Agent }
    | { readonly error: { readonly code: string; readonly message: string } }

  /**
   * The controller every browser prompt goes through. It owns resume policy, so
   * `resolveAgent` wakes a cold session rather than failing, and `prompt`
   * admits one message into that session's inbox.
   */
  export interface SessionControllerService {
    resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult>
    prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<{ readonly accepted: true }>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-tools — the tool registry
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-tools' {
  import type { Disposer, JsonValue } from '@deepseek-ai/cordis'
  import type { Agent } from '@deepseek-ai/dsh-agent'
  import type { ContentBlock } from '@deepseek-ai/dsh-llm'

  export type { Disposer }

  export interface ToolOutputDefinition {
    /** JSON Schema enforced against every successful canonical value. */
    readonly schema: Record<string, unknown>
    /** Pure projection from validated arguments and value to model-visible content. */
    render(args: unknown, value: JsonValue): ContentBlock[]
  }

  /** Execution identity handed to a tool body after the registry accepts the call. */
  export interface ToolRunContext {
    /** The exact live Agent that requested this call. */
    readonly agent: Agent
    /** Caller cancellation, fused with every wrapper's own replacement. */
    readonly signal: AbortSignal
    readonly callId: string
  }

  export interface ToolDefinition {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
    readonly output: ToolOutputDefinition
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  }

  export interface ToolsService {
    register(definition: ToolDefinition): Disposer
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/schemastery — the settings schema language
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/schemastery' {
  /**
   * The schema factory the harness uses for every settings section.
   *
   * Declared as an ambient module rather than resolved from `node_modules`
   * because `@deepseek-ai/schemastery` is a runtime-owned library: it ships with
   * the harness workspace, not with this package. The import in `src/index.ts`
   * is real and dynamic, so a deployment that lacks it degrades to static
   * configuration instead of failing to load.
   */
  export interface SchemaFactory {
    object<T>(description: Record<string, unknown>): T
  }

  const Schema: SchemaFactory
  export default Schema
}

// ─────────────────────────────────────────────────────────────────────────────
// @deepseek-ai/dsh-settings — the settings document
// ─────────────────────────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-settings' {
  import type { Context, Disposer } from '@deepseek-ai/cordis'

  export type { Context, Disposer }

  /**
   * The schema surface `installSection` requires, declared structurally.
   *
   * A schema value comes from `@deepseek-ai/schemastery`
   * (`Schema.object({ ... })`), which the harness workspace always carries.
   * Binding to its concrete class would force this package to declare a
   * dependency on a runtime-owned library, so only the three capabilities the
   * settings document actually uses are named here: validating a value,
   * projecting a JSON Schema for the GUI, and deriving a default.
   */
  export interface SettingsSchema<T> {
    (value: unknown): T
    /** JSON Schema handed to configuration surfaces such as the plugin card. */
    toJSON(): Record<string, unknown>
    /** Returns a copy of this schema with a new implicit default. */
    default(value: T): SettingsSchema<T>
  }

  /**
   * Hooks a consumer hands to {@link SettingsProvider.installSection}.
   *
   * `setSource` receives the currently authoritative configuration as a thunk:
   * the resolved settings scope while one is attached, the composition entry
   * otherwise. `onChange` re-judges anything derived from that source.
   */
  export interface SettingsSectionHooks<T> {
    setSource(current: () => T): void
    onChange(): void
  }

  export interface SettingsProvider {
    readonly writable: boolean
    /**
     * Declare one namespace of the settings document and keep a live view of it.
     *
     * @param owner - the registering plugin's context, which owns the lifetime.
     * @param ns - lowercase hyphenated namespace identifier.
     * @param schema - validation and JSON-Schema projection for the section.
     * @param entry - the composition layer's own values for this section.
     * @param hooks - how the consumer learns about the active value and changes.
     */
    installSection<const Namespace extends string, T>(
      owner: Context,
      ns: Namespace,
      schema: SettingsSchema<T>,
      entry: T,
      hooks: SettingsSectionHooks<T>,
    ): void
    describe(options?: { redactSecrets?: boolean }): readonly SettingsDescriptor[]
    get<const Namespace extends string>(ns: Namespace): unknown
  }

  export interface SettingsDescriptor {
    readonly ns: string
    readonly schema: unknown
    readonly value: unknown
    readonly revision: number
    readonly base?: unknown
    readonly user?: unknown
    readonly applies: 'live' | 'reload' | 'restart'
  }
}
