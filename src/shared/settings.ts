import type { PromptDeliveryMode } from '@deepseek-ai/dsh-api-session-controller'

/**
 * The resolved, always-valid configuration of this plugin.
 *
 * Every field here is a decision the model cannot make and a user might want
 * differently. The defaults are chosen so that a fresh install is useful
 * immediately and can never surprise the user with an unbounded action:
 * reads are capped, sends are capped, and nothing writes to another session
 * unless the model explicitly asks for it by id.
 */
export interface CrossSessionSettings {
  /** Master switch. When false the plugin registers no tools at all. */
  readonly enabled: boolean

  /** Delivery mode used when a `sessions_send` call omits `mode`. */
  readonly defaultSendMode: PromptDeliveryMode

  /**
   * Whether a send may wake a session that is not currently live.
   *
   * Resuming a cold session costs a real turn against that session's model
   * route, so a deployment that wants reads only can leave this off.
   */
  readonly allowResume: boolean

  /**
   * Whether a delivered message is prefixed with a machine-readable frame
   * naming the sending session.
   *
   * Without it the receiving model sees an ordinary user turn and cannot tell a
   * peer session from the human. With it, the receiver can reply by id.
   */
  readonly frameMessages: boolean

  /** Include harness-injected context when reading another session by default. */
  readonly includeInjectedByDefault: boolean

  /** Upper bound on rows `sessions_list` will ever return. */
  readonly maxListResults: number

  /** Upper bound on messages `sessions_read` will ever return. */
  readonly maxReadMessages: number

  /** Per-message character budget before a read truncates. */
  readonly maxMessageChars: number

  /** Upper bound on the body length `sessions_send` will deliver. */
  readonly maxSendChars: number
}

/**
 * Composition-level defaults.
 *
 * These are the values a deployment gets with no settings document entry at
 * all. They are intentionally conservative on volume and permissive on
 * capability, because a tool that cannot act is indistinguishable from a
 * broken install.
 */
export const DEFAULT_SETTINGS: CrossSessionSettings = {
  enabled: true,
  defaultSendMode: 'queue',
  allowResume: true,
  frameMessages: true,
  includeInjectedByDefault: false,
  maxListResults: 25,
  maxReadMessages: 12,
  maxMessageChars: 1200,
  maxSendChars: 4000,
}

/**
 * Inclusive bounds for every numeric setting.
 *
 * Applied on top of schema validation because a composition row can supply a
 * value that never travelled through the settings document.
 */
const LIMITS = {
  maxListResults: { min: 1, max: 200 },
  maxReadMessages: { min: 1, max: 100 },
  maxMessageChars: { min: 100, max: 20_000 },
  maxSendChars: { min: 100, max: 40_000 },
} as const satisfies Record<string, { min: number; max: number }>

/**
 * Clamp one numeric setting into its supported range.
 *
 * A non-finite or non-numeric value falls back to the default rather than
 * throwing: configuration is user input, and a plugin that refuses to load
 * over a typo is worse than one that logs and continues.
 */
function clamp(name: keyof typeof LIMITS, value: unknown): number {
  const fallback = DEFAULT_SETTINGS[name]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const { min, max } = LIMITS[name]
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Narrow an unknown value to a delivery mode, falling back to the default. */
export function normalizeSendMode(value: unknown): PromptDeliveryMode {
  return value === 'steer' || value === 'queue' ? value : DEFAULT_SETTINGS.defaultSendMode
}

/** Narrow an unknown value to a boolean, falling back to the default. */
function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Fold a partially-known configuration into a fully valid one.
 *
 * Accepts `unknown` on purpose: the input may come from a composition row, from
 * the settings document, or from a test. Nothing in this function throws.
 */
export function resolveSettings(input: unknown): CrossSessionSettings {
  const raw: Record<string, unknown> =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

  return {
    enabled: booleanOr(raw['enabled'], DEFAULT_SETTINGS.enabled),
    defaultSendMode: normalizeSendMode(raw['defaultSendMode']),
    allowResume: booleanOr(raw['allowResume'], DEFAULT_SETTINGS.allowResume),
    frameMessages: booleanOr(raw['frameMessages'], DEFAULT_SETTINGS.frameMessages),
    includeInjectedByDefault: booleanOr(
      raw['includeInjectedByDefault'],
      DEFAULT_SETTINGS.includeInjectedByDefault,
    ),
    maxListResults: clamp('maxListResults', raw['maxListResults']),
    maxReadMessages: clamp('maxReadMessages', raw['maxReadMessages']),
    maxMessageChars: clamp('maxMessageChars', raw['maxMessageChars']),
    maxSendChars: clamp('maxSendChars', raw['maxSendChars']),
  }
}
