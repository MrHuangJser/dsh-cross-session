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
}
