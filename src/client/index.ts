import { type ReactNode, createElement } from 'react'

import { PLUGIN_NAME, SETTINGS_NAMESPACE } from '../shared/meta.ts'
import { type CrossSessionSettings, DEFAULT_SETTINGS } from '../shared/settings.ts'

/**
 * The browser half of dsh-cross-session: one card in the **Plugins** settings
 * section, under **Plugin configuration**.
 *
 * The card is dispatched by the section that owns `settings.plugin.item`, keyed
 * by the settings namespace this package declares on the Host. Registering the
 * card under `SETTINGS_NAMESPACE` is what makes the Host section visible in the
 * GUI at all: the section renders the intersection of the namespaces the Host
 * serves and the cards registered here, so neither half alone shows anything.
 */

/** The fields this card renders, in order, with their GUI labels. */
interface FieldSpec {
  readonly key: keyof CrossSessionSettings
  readonly label: string
  readonly hint: string
  readonly kind: 'boolean' | 'number' | 'mode'
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'enabled',
    label: 'Enable cross-session tools',
    hint: 'Registers sessions_list, sessions_read, and sessions_send for every session.',
    kind: 'boolean',
  },
  {
    key: 'defaultSendMode',
    label: 'Default delivery mode',
    hint: 'queue delivers as the target next turn; steer inserts into the turn it is running now.',
    kind: 'mode',
  },
  {
    key: 'allowResume',
    label: 'Allow waking cold sessions',
    hint: 'When off, sending to a session that is not live is refused and nothing is resumed.',
    kind: 'boolean',
  },
  {
    key: 'frameMessages',
    label: 'Frame delivered messages',
    hint: 'Prefixes each message with the sending session, so the receiver can tell a peer from the human.',
    kind: 'boolean',
  },
  {
    key: 'includeInjectedByDefault',
    label: 'Include harness-injected context when reading',
    hint: 'System reminders and memory snapshots are hidden by default because they are not what a session discussed.',
    kind: 'boolean',
  },
  {
    key: 'maxListResults',
    label: 'Max sessions listed',
    hint: 'Upper bound on rows sessions_list returns.',
    kind: 'number',
  },
  {
    key: 'maxReadMessages',
    label: 'Max messages read',
    hint: 'Upper bound on messages sessions_read returns.',
    kind: 'number',
  },
  {
    key: 'maxMessageChars',
    label: 'Characters per read message',
    hint: 'Per-message budget before a read truncates.',
    kind: 'number',
  },
  {
    key: 'maxSendChars',
    label: 'Characters per sent message',
    hint: 'Upper bound on a delivered message body.',
    kind: 'number',
  },
]

/**
 * The settings scope this card edits.
 *
 * Provided by `@deepseek-ai/dsh-client-ui-settings`. The shape is declared
 * structurally for the same reason the Host types are: the client UI packages
 * are runtime-owned, and this card uses one method of one of them.
 */
export interface SettingsScope<T> {
  get(): T
  set(key: string, value: unknown): void
  reset(key: string): void
  readonly revision: number
}

/**
 * One contribution to a keyed slot.
 *
 * The shape mirrors what the settings section reads: the `key` decides which
 * served namespace this cell answers for, and `inject` supplies the props the
 * card component receives.
 */
export interface SlotContribution {
  readonly name: string
  readonly key: string
  readonly inject: () => { readonly scope: SettingsScope<Record<string, unknown>> | undefined }
}

export interface ClientContext {
  readonly logger: { warn(...values: unknown[]): void; info(...values: unknown[]): void }
  get(name: string): unknown
}

/** Read the settings scope service, or `undefined` when this shell has none. */
function settingsScopeOf(ctx: ClientContext): SettingsScope<Record<string, unknown>> | undefined {
  const found = ctx.get('settingsScope')
  if (typeof found !== 'object' || found === null) return undefined
  const scope = found as { bind?: (spec: { namespace: string }) => SettingsScope<unknown> }
  if (typeof scope.bind !== 'function') return undefined
  return scope.bind({ namespace: SETTINGS_NAMESPACE }) as SettingsScope<Record<string, unknown>>
}

/** Read the slot registry, or `undefined` when this shell has none. */
function slotsOf(
  ctx: ClientContext,
): { inject(key: string, callback: () => unknown): () => void } | undefined {
  const found = ctx.get('slots')
  if (typeof found !== 'object' || found === null) return undefined
  const slots = found as { inject?: unknown }
  return typeof slots.inject === 'function'
    ? (slots as { inject(key: string, callback: () => unknown): () => void })
    : undefined
}

/** Read one field's current value, falling back to the documented default. */
function currentValue(
  scope: SettingsScope<Record<string, unknown>> | undefined,
  key: keyof CrossSessionSettings,
): unknown {
  const fallback: unknown = DEFAULT_SETTINGS[key]
  if (scope === undefined) return fallback
  try {
    const section = scope.get()
    const value = section[key]
    return value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

/** Render one editable row. */
function renderField(
  spec: FieldSpec,
  scope: SettingsScope<Record<string, unknown>> | undefined,
): ReactNode {
  const id = `${SETTINGS_NAMESPACE}-${spec.key}`
  const value = currentValue(scope, spec.key)

  let control: ReactNode
  if (spec.kind === 'boolean') {
    control = createElement('input', {
      id,
      type: 'checkbox',
      checked: value === true,
      disabled: scope === undefined,
      onChange: () => {
        scope?.set(spec.key, value !== true)
      },
    })
  } else if (spec.kind === 'mode') {
    control = createElement(
      'select',
      {
        id,
        value: typeof value === 'string' ? value : DEFAULT_SETTINGS.defaultSendMode,
        disabled: scope === undefined,
        onChange: (event: { target: { value: string } }) => {
          scope?.set(spec.key, event.target.value)
        },
      },
      createElement('option', { key: 'queue', value: 'queue' }, 'queue'),
      createElement('option', { key: 'steer', value: 'steer' }, 'steer'),
    )
  } else {
    control = createElement('input', {
      id,
      type: 'number',
      value: typeof value === 'number' ? value : Number(DEFAULT_SETTINGS[spec.key]),
      disabled: scope === undefined,
      onChange: (event: { target: { value: string } }) => {
        const parsed = Number(event.target.value)
        if (Number.isFinite(parsed)) scope?.set(spec.key, parsed)
      },
    })
  }

  return createElement(
    'div',
    { key: spec.key, className: 'cross-session-field' },
    createElement(
      'label',
      { htmlFor: id },
      createElement('span', { className: 'cross-session-field-label' }, spec.label),
      control,
    ),
    createElement('p', { className: 'cross-session-field-hint' }, spec.hint),
  )
}

/** The card component the shell renders inside `settings.plugin.item`. */
function CrossSessionCard(): ReactNode {
  // The scope is read per render from the injected context rather than closed
  // over at registration, because the shell remounts cards across reconnects.
  const scope = (CrossSessionCard as unknown as { scope?: SettingsScope<Record<string, unknown>> })
    .scope

  return createElement(
    'div',
    { className: 'cross-session-card' },
    createElement(
      'p',
      { className: 'cross-session-intro' },
      'Lets one session list, read, and message other sessions of this harness. ' +
        'Sending wakes a cold session only when "Allow waking cold sessions" is on.',
    ),
    ...FIELDS.map((spec) => renderField(spec, scope)),
    createElement(
      'p',
      { className: 'cross-session-footnote' },
      scope === undefined
        ? 'The settings service is unavailable in this shell; values shown are the composed defaults.'
        : `Settings apply live. Namespace: ${SETTINGS_NAMESPACE}.`,
    ),
  )
}

/**
 * Cordis plugin entry point for the browser half.
 *
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const scope = settingsScopeOf(ctx)

  if (scope === undefined) {
    ctx.logger.warn(
      `${PLUGIN_NAME}: the client settings service is not composed, so the settings card is not registered.`,
    )
  }

  const slots = slotsOf(ctx)
  if (slots === undefined) {
    ctx.logger.warn(`${PLUGIN_NAME}: the client slot service is not composed; no UI registered.`)
    return
  }

  slots.inject('settings.plugin.item', (): SlotContribution => ({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    // The section reads this key's occupant from the Host's served namespaces.
    inject: () => ({ scope }),
  }))
}

/** Cordis plugin metadata consumed by the client module system. */
export const name = PLUGIN_NAME

/** Client services this bundle resolves before running. */
export const inject = ['slots'] as const

export { CrossSessionCard }
