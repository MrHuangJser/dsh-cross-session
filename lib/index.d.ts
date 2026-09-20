import { Context, Disposer } from "@deepseek-ai/cordis";
import { PromptDeliveryMode } from "@deepseek-ai/dsh-api-session-controller";

//#region src/shared/meta.d.ts
/**
* Package identity shared by both halves of the plugin.
*
* `SETTINGS_NAMESPACE` is the single key that ties three things together: the
* Host settings section, the browser settings card registered into
* `settings.plugin.item`, and any composition row config. Changing it silently
* detaches the card from its namespace, so it is defined exactly once.
*/
/** Lowercase hyphenated settings namespace, per the settings document's rules. */
/**
 * Package identity shared by both halves of the plugin.
 *
 * `SETTINGS_NAMESPACE` is the single key that ties three things together: the
 * Host settings section, the browser settings card registered into
 * `settings.plugin.item`, and any composition row config. Changing it silently
 * detaches the card from its namespace, so it is defined exactly once.
 */
/** Lowercase hyphenated settings namespace, per the settings document's rules. */
declare const SETTINGS_NAMESPACE: "cross-session";

//#endregion
//#region src/shared/settings.d.ts
/** Host plugin name, used by the Cordis loader and by log lines. */
/**
 * The resolved, always-valid configuration of this plugin.
 *
 * Every field here is a decision the model cannot make and a user might want
 * differently. The defaults are chosen so that a fresh install is useful
 * immediately and can never surprise the user with an unbounded action:
 * reads are capped, sends are capped, and nothing writes to another session
 * unless the model explicitly asks for it by id.
 */
interface CrossSessionSettings {
  /** Master switch. When false the plugin registers no tools at all. */
  readonly enabled: boolean;
  /** Delivery mode used when a `sessions_send` call omits `mode`. */
  readonly defaultSendMode: PromptDeliveryMode;
  /**
   * Whether a send may wake a session that is not currently live.
   *
   * Resuming a cold session costs a real turn against that session's model
   * route, so a deployment that wants reads only can leave this off.
   */
  readonly allowResume: boolean;
  /**
   * Whether a delivered message is prefixed with a machine-readable frame
   * naming the sending session.
   *
   * Without it the receiving model sees an ordinary user turn and cannot tell a
   * peer session from the human. With it, the receiver can reply by id.
   */
  readonly frameMessages: boolean;
  /** Include harness-injected context when reading another session by default. */
  readonly includeInjectedByDefault: boolean;
  /** Upper bound on rows `sessions_list` will ever return. */
  readonly maxListResults: number;
  /** Upper bound on messages `sessions_read` will ever return. */
  readonly maxReadMessages: number;
  /** Per-message character budget before a read truncates. */
  readonly maxMessageChars: number;
  /** Upper bound on the body length `sessions_send` will deliver. */
  readonly maxSendChars: number;
} //#endregion
//#region src/index.d.ts

/**
 * Composition-level defaults.
 *
 * These are the values a deployment gets with no settings document entry at
 * all. They are intentionally conservative on volume and permissive on
 * capability, because a tool that cannot act is indistinguishable from a
 * broken install.
 */
/**
 * The Host half of dsh-cross-session.
 *
 * Lifecycle, in order:
 *  1. resolve the Host services this plugin consumes, failing loudly at mount
 *     when one is absent rather than at the model's first tool call;
 *  2. read the initial configuration — the composition row's own config, which
 *     the settings document then overrides once a section attaches;
 *  3. declare that settings section so the GUI can edit it live;
 *  4. register the three model-facing tools behind one disposer.
 */
/** The plugin's own configuration, as it appears in a composition row. */
type Config = Readonly<Record<string, unknown>>;
/**
 * Cordis plugin entry point for the Host half.
 *
 * @param ctx - the plugin context, which owns every registration this makes.
 * @param config - the composition row's own configuration, used as the base layer.
 * @returns a disposer that unregisters the tools, or `undefined` when the
 *   registration is already owned by `ctx.effect`. Synchronous by design: the
 *   loader does not await a Promise from `apply`, so every registration must
 *   happen in one call frame.
 */
declare function apply(ctx: Context, config?: Config): Disposer | undefined;
/** Cordis plugin metadata consumed by the loader. */
declare const name: "dsh-cross-session";
/** Hard dependencies: without these the tools cannot do their job at all. */
declare const inject: readonly ["sessionQuery", "sessionController", "agents", "tools"];

//#endregion
export { Config, CrossSessionSettings, SETTINGS_NAMESPACE, apply, inject, name };