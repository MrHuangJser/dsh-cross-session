import { ReactNode } from "react";

//#region src/client/index.d.ts
/**
* The settings scope this card edits.
*
* Provided by `@deepseek-ai/dsh-client-ui-settings`. The shape is declared
* structurally for the same reason the Host types are: the client UI packages
* are runtime-owned, and this card uses one method of one of them.
*/
/**
 * The settings scope this card edits.
 *
 * Provided by `@deepseek-ai/dsh-client-ui-settings`. The shape is declared
 * structurally for the same reason the Host types are: the client UI packages
 * are runtime-owned, and this card uses one method of one of them.
 */
interface SettingsScope<T> {
  get(): T;
  set(key: string, value: unknown): void;
  reset(key: string): void;
  readonly revision: number;
}
/**
 * One contribution to a keyed slot.
 *
 * The shape mirrors what the settings section reads: the `key` decides which
 * served namespace this cell answers for, and `inject` supplies the props the
 * card component receives.
 */
interface SlotContribution {
  readonly name: string;
  readonly key: string;
  readonly inject: () => {
    readonly scope: SettingsScope<Record<string, unknown>> | undefined;
  };
}
interface ClientContext {
  readonly logger: {
    warn(...values: unknown[]): void;
    info(...values: unknown[]): void;
  };
  get(name: string): unknown;
}
/** The card component the shell renders inside `settings.plugin.item`. */
declare function CrossSessionCard(): ReactNode;
/**
 * Cordis plugin entry point for the browser half.
 *
 * @param ctx - the client plugin context.
 */
declare function apply(ctx: ClientContext): void;
/** Cordis plugin metadata consumed by the client module system. */
declare const name: "dsh-cross-session";
/** Client services this bundle resolves before running. */
declare const inject: readonly ["slots"]; //#endregion
export { ClientContext, CrossSessionCard, SettingsScope, SlotContribution, apply, inject, name };