import { ReactNode } from "react";

//#region src/client/index.d.ts
/**
* The bound settings scope (`ctx.settingsScope.bind({ namespace })` returns
* exactly this shape: `set` commits a write, `subscribe` reports changes).
*/
/**
 * The bound settings scope (`ctx.settingsScope.bind({ namespace })` returns
 * exactly this shape: `set` commits a write, `subscribe` reports changes).
 */
interface BoundScope {
  set(key: string, value: unknown): unknown;
  subscribe(listener: () => void): () => void;
  get?(): unknown;
}
interface SettingsScopeBinder {
  bind(spec: {
    namespace: string;
  }): BoundScope;
}
/** The store shape the slot machinery turns into a `use*` hook. */
interface ScopeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Record<string, unknown>;
}
interface ClientLogger {
  warn(...values: unknown[]): void;
  info(...values: unknown[]): void;
}
interface ClientContext {
  readonly logger: ClientLogger;
  readonly locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void;
    bind(ns: string): (key: string) => string;
  };
  readonly settingsScope: SettingsScopeBinder;
  readonly slots: {
    inject(name: string, callback: () => unknown): () => void;
    register(spec: unknown, component: unknown): unknown;
  };
  effect(callback: () => () => void, label?: string): () => void;
  get(name: string): unknown;
}
/** The card component registered into `settings.plugin.item`. */
declare function CrossSessionCard(props: {
  readonly t?: (key: string) => string;
  readonly useCrossSession?: (selector: (snapshot: Record<string, unknown>) => Record<string, unknown>) => Record<string, unknown> | undefined;
  readonly scope?: BoundScope;
  readonly tFallback?: (key: string) => string;
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
 * Required services (cordis fiber inject): the slot registry, the locale
 * service for card strings, and the settings scope that backs every control.
 * Service names, not package names — `dsh.client.inject` in `package.json` is
 * what orders their providers before this bundle.
 */
declare const inject: readonly ["slots", "locale", "settingsScope"]; //#endregion
export { BoundScope, ClientContext, ClientLogger, CrossSessionCard, ScopeStore, SettingsScopeBinder, apply, inject, name };