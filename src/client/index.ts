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
 * are runtime-owned, and this card uses a handful of methods on one of them.
 */
export interface SettingsScope {
  /** The resolved section value: composition base merged with user overrides. */
  get(): Record<string, unknown>
  /** Write one field into the namespace's user layer. */
  set(key: string, value: unknown): void
  /** Remove one field's user override, restoring the composed base. */
  reset(key: string): void
}

export interface SettingsScopeBinder {
  bind(spec: { namespace: string }): SettingsScope
}

/** One contribution to a keyed slot. */
export interface SlotContribution {
  readonly name: string
  readonly key: string
  readonly inject: () => { readonly scope: SettingsScope | undefined }
}

export interface ClientLogger {
  warn(...values: unknown[]): void
  info(...values: unknown[]): void
}

export interface ClientContext {
  readonly logger: ClientLogger
  get(name: string): unknown
}

/**
 * Read a service defensively: `ctx.get` first, the direct property as fallback.
 *
 * The caller names the shape it expects — a shell that supplies a different
 * implementation under the same key is out of contract, and the card degrades
 * to composed defaults rather than throwing in render.
 */
function serviceOf(ctx: ClientContext, name: string): unknown {
  const viaGet = ctx.get(name)
  if (viaGet !== undefined && viaGet !== null) return viaGet
  return (ctx as unknown as Record<string, unknown>)[name]
}

/** Read the settings scope service, or `undefined` when this shell has none. */
function scopeOf(ctx: ClientContext): SettingsScope | undefined {
  const binder = serviceOf(ctx, 'settingsScope') as SettingsScopeBinder | undefined
  if (binder === undefined || typeof binder.bind !== 'function') return undefined
  try {
    return binder.bind({ namespace: SETTINGS_NAMESPACE })
  } catch {
    return undefined
  }
}

/** Read the slot registry, or `undefined` when this shell has none. */
function slotsOf(
  ctx: ClientContext,
): { inject(key: string, callback: () => SlotContribution): () => void } | undefined {
  return serviceOf(ctx, 'slots') as
    { inject(key: string, callback: () => SlotContribution): () => void } | undefined
}

/** Read one field's current value, falling back to the documented default. */
function currentValue(scope: SettingsScope | undefined, key: keyof CrossSessionSettings): unknown {
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
function renderField(spec: FieldSpec, scope: SettingsScope | undefined): ReactNode {
  const id = `${SETTINGS_NAMESPACE}-${spec.key}`
  const value = currentValue(scope, spec.key)
  const disabled = scope === undefined

  let control: ReactNode
  if (spec.kind === 'boolean') {
    control = createElement('input', {
      id,
      type: 'checkbox',
      checked: value === true,
      disabled,
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
        disabled,
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
      disabled,
      onChange: (event: { target: { value: string } }) => {
        const parsed = Number(event.target.value)
        if (Number.isFinite(parsed)) scope?.set(spec.key, parsed)
      },
    })
  }

  return createElement(
    'div',
    { key: spec.key, className: 'dshxs-field' },
    createElement(
      'label',
      { htmlFor: id },
      createElement('span', { className: 'dshxs-field-label' }, spec.label),
      control,
    ),
    createElement('p', { className: 'dshxs-field-hint' }, spec.hint),
  )
}

/**
 * The card component.
 *
 * The section supplies no owner props for `settings.plugin.item`, so the scope
 * the card edits is captured through `inject` rather than read inside render.
 */
function CrossSessionCard(props: { readonly scope?: SettingsScope }): ReactNode {
  const scope = props.scope

  return createElement(
    'div',
    { className: 'dshxs-card' },
    createElement(
      'p',
      { className: 'dshxs-intro' },
      'Lets one session list, read, and message other sessions of this harness. ' +
        'Sending wakes a cold session only when "Allow waking cold sessions" is on.',
    ),
    ...FIELDS.map((spec) => renderField(spec, scope)),
    createElement(
      'p',
      { className: 'dshxs-footnote' },
      scope === undefined
        ? 'The settings service is unavailable in this shell; values shown are the composed defaults.'
        : `Settings apply live. Namespace: ${SETTINGS_NAMESPACE}.`,
    ),
  )
}

/**
 * The stylesheet this card injects.
 *
 * Shipped client plugins inject their CSS as a `<style data-plugin-css>` tag in
 * the document head; this follows the same shape so the tag is reclaimed with
 * the module rather than accumulating.
 */
const CARD_CSS =
  '.dshxs-card{display:flex;flex-direction:column;gap:4px}' +
  '.dshxs-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;margin:0 0 8px}' +
  '.dshxs-field{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2)}' +
  '.dshxs-field:first-of-type{border-top:none}' +
  '.dshxs-field label{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer}' +
  '.dshxs-field-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}' +
  '.dshxs-field input[type=checkbox]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}' +
  '.dshxs-field input[type=number],.dshxs-field select{font:inherit;color:var(--dsw-alias-label-primary);' +
  'background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;' +
  'height:30px;padding:0 10px;min-width:120px}' +
  '.dshxs-field-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}' +
  '.dshxs-footnote{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:8px 0 0}'

/** Attach the card's stylesheet once per document. */
function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = `${SETTINGS_NAMESPACE}/card.css`
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset['plugin'] = PLUGIN_NAME
  tag.dataset['pluginCss'] = tagId
  tag.textContent = CARD_CSS
  document.head.appendChild(tag)
}

/**
 * Cordis plugin entry point for the browser half.
 *
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const scope = scopeOf(ctx)
  if (scope === undefined) {
    ctx.logger.warn(
      `${PLUGIN_NAME}: the client settings service is not composed; the card will show composed defaults.`,
    )
  }

  const slots = slotsOf(ctx)
  if (slots === undefined) {
    ctx.logger.warn(`${PLUGIN_NAME}: the client slot service is not composed; no UI registered.`)
    return
  }

  injectStyles()

  slots.inject('settings.plugin.item', (): SlotContribution => ({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    // The section reads this key's occupant from the Host's served namespaces.
    inject: () => ({ scope }),
  }))
}

/** Cordis plugin metadata consumed by the client module system. */
export const name = PLUGIN_NAME

/**
 * Required services (cordis fiber inject).
 *
 * Both are provided by `@deepseek-ai/dsh-client-ui-settings` and the slot core.
 * Service names, not package names: the package-level `dsh.client.inject` in
 * `package.json` is what orders those providers before this bundle.
 */
export const inject = ['settingsScope', 'slots'] as const

export { CrossSessionCard }
