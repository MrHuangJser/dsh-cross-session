import { ReactNode } from "react";

//#region src/client/index.d.ts
/**
* The settings scope this card edits.
*
* Provided by `@deepseek-ai/dsh-client-ui-settings`. The shape is declared
* structurally for the same reason the Host types are: the client UI packages
* are runtime-owned, and this card uses a handful of methods on one of them.
*/
/**
 * The settings scope this card edits.
 *
 * Provided by `@deepseek-ai/dsh-client-ui-settings`. The shape is declared
 * structurally for the same reason the Host types are: the client UI packages
 * are runtime-owned, and this card uses a handful of methods on one of them.
 */
interface SettingsScope {
  /** The resolved section value: composition base merged with user overrides. */
  get(): Record<string, unknown>;
  /** Write one field into the namespace's user layer. */
  set(key: string, value: unknown): void;
  /** Remove one field's user override, restoring the composed base. */
  reset(key: string): void;
}
interface SettingsScopeBinder {
  bind(spec: {
    namespace: string;
  }): SettingsScope;
}
/** One contribution to a keyed slot. */
interface SlotContribution {
  readonly name: string;
  readonly key: string;
  readonly inject: () => {
    readonly scope: SettingsScope | undefined;
  };
}
interface ClientLogger {
  warn(...values: unknown[]): void;
  info(...values: unknown[]): void;
}
interface ClientContext {
  readonly logger: ClientLogger;
  get(name: string): unknown;
}
/**
 * The card component.
 *
 * The section supplies no owner props for `settings.plugin.item`, so the scope
 * the card edits is captured through `inject` rather than read inside render.
 */
declare function CrossSessionCard(props: {
  readonly scope?: SettingsScope;
}): ReactNode;
/**
 * Cordis plugin entry point for the browser half.
 *
 * @param ctx - the client plugin context.
 */
declare function apply(ctx: ClientContext): void;
/** Cordis plugin metadata consumed by the client module system. */
declare const name: "dsh-cross-session";
/**
 * Required services (cordis fiber inject).
 *
 * Both are provided by `@deepseek-ai/dsh-client-ui-settings` and the slot core.
 * Service names, not package names: the package-level `dsh.client.inject` in
 * `package.json` is what orders those providers before this bundle.
 */
declare const inject: readonly ["settingsScope", "slots"]; //#endregion
export { ClientContext, ClientLogger, CrossSessionCard, SettingsScope, SettingsScopeBinder, SlotContribution, apply, inject, name };