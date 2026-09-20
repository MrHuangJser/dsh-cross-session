/**
 * Minimal React surface used by the settings card.
 *
 * The shell seeds React into a frozen module table the plugin bundle resolves
 * against, so `react` is a real import at runtime but has no types installed in
 * this repository. Declaring the two members actually used keeps the card
 * type-checked without vendoring React's types or depending on the version the
 * shell happens to seed.
 */
declare module 'react' {
  export type ReactNode = unknown

  export interface ChangeEvent<T = unknown> {
    readonly target: T
  }

  export interface InputProps {
    readonly type?: string
    readonly value?: string | number
    readonly checked?: boolean
    readonly disabled?: boolean
    readonly id?: string
    readonly onChange?: (event: ChangeEvent) => void
  }

  export function createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): ReactNode

  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T
  export function useSyncExternalStore<T>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T
}
