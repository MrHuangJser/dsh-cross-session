import { type ReactNode, createElement, useState } from 'react'

import { PLUGIN_NAME, SETTINGS_NAMESPACE } from '../shared/meta.ts'
import { type CrossSessionSettings, DEFAULT_SETTINGS } from '../shared/settings.ts'

/**
 * The browser half of @mrhuangjser/dsh-cross-session: one expandable card in **Settings →
 * Plugins → Plugin configuration**.
 *
 * The card is dispatched by the section that owns `settings.plugin.item`, keyed
 * by the settings namespace this package declares on the Host. Registering the
 * card under `SETTINGS_NAMESPACE` is what makes the Host section visible in the
 * GUI at all: the section renders the intersection of the namespaces the Host
 * serves and the cards registered here, so neither half alone shows anything.
 */

/** Dictionary namespace for this plugin's strings. */
const NS = SETTINGS_NAMESPACE

const DICT_ZH = {
  title: '跨会话',
  desc: '让一个会话列出、读取并给其他会话发消息。',
  intro:
    '跨会话能力让一个会话可以发现、读取并向其他顶层会话投递消息。冷会话只有开启「允许唤醒冷会话」才会被唤醒。',
  expand: '展开',
  collapse: '收起',
  readOnly: '此部署的 settings 只读，显示值为组合默认。',
  unavailable: 'settings 服务在此 shell 不可用，显示值为组合默认。',
  fieldEnabled: '启用跨会话工具',
  hintEnabled: '注册 sessions_list、sessions_read、sessions_send。',
  fieldDefaultSendMode: '默认投递模式',
  hintDefaultSendMode: 'queue 作为对方下一轮投递；steer 插入对方当前轮次。',
  fieldAllowResume: '允许唤醒冷会话',
  hintAllowResume: '关闭时，向未加载会话发送会被拒绝，绝不唤醒。',
  fieldFrameMessages: '为投递消息加框',
  hintFrameMessages: '在消息前加上发送方会话标识，便于对方回复。',
  fieldIncludeInjected: '读取时包含注入上下文',
  hintIncludeInjected: '默认隐藏系统提醒、记忆快照等 harness 注入内容。',
  fieldMaxListResults: '列出会话上限',
  hintMaxListResults: 'sessions_list 返回的最大行数。',
  fieldMaxReadMessages: '读取消息上限',
  hintMaxReadMessages: 'sessions_read 返回的最大消息数。',
  fieldMaxMessageChars: '单条消息字符上限',
  hintMaxMessageChars: '读取时超过即截断。',
  fieldMaxSendChars: '发送消息字符上限',
  hintMaxSendChars: '投递正文的最大长度。',
  liveNote: '设置实时生效。命名空间：cross-session。',
}

const DICT_EN = {
  title: 'Cross-session',
  desc: 'Let one session list, read, and message other sessions.',
  intro:
    'Cross-session tools let one conversation discover, read, and deliver messages to other top-level sessions. A cold session is only woken when "Allow waking cold sessions" is on.',
  expand: 'Expand',
  collapse: 'Collapse',
  readOnly:
    'The settings document is read-only in this deployment; shown values are the composed defaults.',
  unavailable:
    'The settings service is unavailable in this shell; shown values are the composed defaults.',
  fieldEnabled: 'Enable cross-session tools',
  hintEnabled: 'Registers sessions_list, sessions_read, and sessions_send.',
  fieldDefaultSendMode: 'Default delivery mode',
  hintDefaultSendMode:
    'queue delivers as the target next turn; steer inserts into the turn it is running now.',
  fieldAllowResume: 'Allow waking cold sessions',
  hintAllowResume:
    'When off, sending to a session that is not live is refused and nothing is resumed.',
  fieldFrameMessages: 'Frame delivered messages',
  hintFrameMessages:
    'Prefixes each message with the sending session, so the receiver can tell a peer from the human.',
  fieldIncludeInjected: 'Include harness-injected context when reading',
  hintIncludeInjected:
    'System reminders and memory snapshots are hidden by default because they are not what a session discussed.',
  fieldMaxListResults: 'Max sessions listed',
  hintMaxListResults: 'Upper bound on rows sessions_list returns.',
  fieldMaxReadMessages: 'Max messages read',
  hintMaxReadMessages: 'Upper bound on messages sessions_read returns.',
  fieldMaxMessageChars: 'Characters per read message',
  hintMaxMessageChars: 'Per-message budget before a read truncates.',
  fieldMaxSendChars: 'Characters per sent message',
  hintMaxSendChars: 'Upper bound on a delivered message body.',
  liveNote: 'Settings apply live. Namespace: cross-session.',
}

type DictKey = keyof typeof DICT_EN

/** The fields this card renders, in order, mapped to dict keys. */
interface FieldSpec {
  readonly key: keyof CrossSessionSettings
  readonly labelKey: DictKey
  readonly hintKey: DictKey
  readonly kind: 'boolean' | 'number' | 'mode'
}

const FIELDS: readonly FieldSpec[] = [
  { key: 'enabled', labelKey: 'fieldEnabled', hintKey: 'hintEnabled', kind: 'boolean' },
  {
    key: 'defaultSendMode',
    labelKey: 'fieldDefaultSendMode',
    hintKey: 'hintDefaultSendMode',
    kind: 'mode',
  },
  { key: 'allowResume', labelKey: 'fieldAllowResume', hintKey: 'hintAllowResume', kind: 'boolean' },
  {
    key: 'frameMessages',
    labelKey: 'fieldFrameMessages',
    hintKey: 'hintFrameMessages',
    kind: 'boolean',
  },
  {
    key: 'includeInjectedByDefault',
    labelKey: 'fieldIncludeInjected',
    hintKey: 'hintIncludeInjected',
    kind: 'boolean',
  },
  {
    key: 'maxListResults',
    labelKey: 'fieldMaxListResults',
    hintKey: 'hintMaxListResults',
    kind: 'number',
  },
  {
    key: 'maxReadMessages',
    labelKey: 'fieldMaxReadMessages',
    hintKey: 'hintMaxReadMessages',
    kind: 'number',
  },
  {
    key: 'maxMessageChars',
    labelKey: 'fieldMaxMessageChars',
    hintKey: 'hintMaxMessageChars',
    kind: 'number',
  },
  {
    key: 'maxSendChars',
    labelKey: 'fieldMaxSendChars',
    hintKey: 'hintMaxSendChars',
    kind: 'number',
  },
]

/**
 * The bound settings scope (`ctx.settingsScope.bind({ namespace })` returns
 * exactly this shape: `set` commits a write, `subscribe` reports changes).
 */
export interface BoundScope {
  set(key: string, value: unknown): unknown
  subscribe(listener: () => void): () => void
  get?(): unknown
}

export interface SettingsScopeBinder {
  bind(spec: { namespace: string }): BoundScope
}

/** The store shape the slot machinery turns into a `use*` hook. */
export interface ScopeStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): Record<string, unknown>
}

export interface ClientLogger {
  warn(...values: unknown[]): void
  info(...values: unknown[]): void
}

export interface ClientContext {
  readonly logger: ClientLogger
  readonly locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string) => string
  }
  readonly settingsScope: SettingsScopeBinder
  readonly slots: {
    inject(name: string, callback: () => unknown): () => void
    register(spec: unknown, component: unknown): unknown
  }
  effect(callback: () => () => void, label?: string): () => void
  get(name: string): unknown
}

/** Build the inject-time store over the bound scope. */
function makeStore(scope: BoundScope): ScopeStore {
  let snapshot: Record<string, unknown> = {}
  const read = (): Record<string, unknown> => {
    try {
      const value = typeof scope.get === 'function' ? scope.get() : undefined
      if (typeof value === 'object' && value !== null) snapshot = value as Record<string, unknown>
    } catch {
      // keep last snapshot on read failure
    }
    return snapshot
  }
  read()
  return {
    subscribe(listener): () => void {
      return scope.subscribe(() => {
        read()
        listener()
      })
    },
    getSnapshot(): Record<string, unknown> {
      return read()
    },
  }
}

/** Write one field, then re-sync the snapshot regardless of the commit result. */
function writeField(scope: BoundScope, key: string, value: unknown): void {
  try {
    const result = scope.set(key, value)
    if (result !== undefined && typeof (result as Promise<unknown>).catch === 'function') {
      ;(result as Promise<unknown>).catch(() => undefined)
    }
  } catch {
    // a refused write leaves the last committed value; the next snapshot
    // re-read shows it rather than the attempted one.
  }
}

/** The card's stylesheet, injected once per document beside shipped plugin CSS. */
const CARD_CSS =
  '.dshxs-card{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;list-style:none}' +
  '.dshxs-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}' +
  '.dshxs-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}' +
  '.dshxs-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}' +
  '.dshxs-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}' +
  '.dshxs-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .2s ease-in-out;flex:none;font-size:12px}' +
  '.dshxs-open .dshxs-chevron{transform:rotate(180deg)}' +
  '.dshxs-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 12px}' +
  '.dshxs-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;margin:8px 0}' +
  '.dshxs-field{display:flex;flex-direction:column;gap:4px;padding:8px 0}' +
  '.dshxs-field+.dshxs-field{border-top:.5px solid var(--dsw-alias-border-l2)}' +
  '.dshxs-field label{display:flex;align-items:center;justify-content:space-between;gap:12px}' +
  '.dshxs-field-label{color:var(--dsw-alias-label-primary);font-size:14px}' +
  '.dshxs-field input[type=checkbox]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}' +
  '.dshxs-field input[type=number],.dshxs-field select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-3));border:.5px solid var(--dsw-alias-border-l4);border-radius:14px;height:30px;padding:0 10px;min-width:120px}' +
  '.dshxs-field-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}' +
  '.dshxs-note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:12px 0 4px}'

function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = `${NS}/card.css`
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset['plugin'] = PLUGIN_NAME
  tag.dataset['pluginCss'] = tagId
  tag.textContent = CARD_CSS
  document.head.appendChild(tag)
}

/** One editable row. */
function renderField(
  spec: FieldSpec,
  t: (key: string) => string,
  value: unknown,
  disabled: boolean,
  scope: BoundScope | undefined,
): ReactNode {
  const id = `${NS}-${spec.key}`
  const fallback: unknown = DEFAULT_SETTINGS[spec.key]

  let control: ReactNode
  if (spec.kind === 'boolean') {
    control = createElement('input', {
      id,
      type: 'checkbox',
      checked: value === true,
      disabled: disabled || scope === undefined,
      onChange: () => {
        if (scope !== undefined) writeField(scope, spec.key, value !== true)
      },
    })
  } else if (spec.kind === 'mode') {
    control = createElement(
      'select',
      {
        id,
        value: typeof value === 'string' ? value : String(fallback),
        disabled: disabled || scope === undefined,
        onChange: (event: { target: { value: string } }) => {
          if (scope !== undefined) writeField(scope, spec.key, event.target.value)
        },
      },
      createElement('option', { key: 'queue', value: 'queue' }, 'queue'),
      createElement('option', { key: 'steer', value: 'steer' }, 'steer'),
    )
  } else {
    control = createElement('input', {
      id,
      type: 'number',
      value: typeof value === 'number' ? value : Number(fallback),
      disabled: disabled || scope === undefined,
      onChange: (event: { target: { value: string } }) => {
        const parsed = Number(event.target.value)
        if (scope !== undefined && Number.isFinite(parsed)) writeField(scope, spec.key, parsed)
      },
    })
  }

  return createElement(
    'div',
    { key: spec.key, className: 'dshxs-field' },
    createElement(
      'label',
      { htmlFor: id },
      createElement('span', { className: 'dshxs-field-label' }, t(spec.labelKey)),
      control,
    ),
    createElement('p', { className: 'dshxs-field-hint' }, t(spec.hintKey)),
  )
}

/** The card component registered into `settings.plugin.item`. */
function CrossSessionCard(props: {
  readonly t?: (key: string) => string
  readonly useCrossSession?: (
    selector: (snapshot: Record<string, unknown>) => Record<string, unknown>,
  ) => Record<string, unknown> | undefined
  readonly scope?: BoundScope
  readonly tFallback?: (key: string) => string
}): ReactNode {
  const t = props.t ?? props.tFallback ?? ((key: string): string => key)
  const [open, setOpen] = useState(false)
  const snapshot =
    typeof props.useCrossSession === 'function' ? props.useCrossSession((s) => s) : undefined

  const scope = props.scope
  const disabled = scope === undefined

  const valueOf = (key: keyof CrossSessionSettings): unknown => {
    const fromScope = snapshot === undefined ? undefined : snapshot[key]
    return fromScope === undefined ? DEFAULT_SETTINGS[key] : fromScope
  }

  return createElement(
    'li',
    { className: 'dshxs-card' + (open ? ' dshxs-open' : '') },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dshxs-head',
        'aria-expanded': open,
        onClick: () => {
          setOpen(!open)
        },
      },
      createElement(
        'span',
        { className: 'dshxs-headtext' },
        createElement('span', { className: 'dshxs-name' }, t('title')),
        createElement('span', { className: 'dshxs-desc' }, t('desc')),
      ),
      createElement('span', { className: 'dshxs-chevron' }, '⌄'),
    ),
    open
      ? createElement(
          'div',
          { className: 'dshxs-body' },
          createElement('p', { className: 'dshxs-intro' }, t('intro')),
          scope === undefined
            ? createElement('p', { className: 'dshxs-note', role: 'status' }, t('unavailable'))
            : null,
          ...FIELDS.map((spec) => renderField(spec, t, valueOf(spec.key), disabled, scope)),
          createElement('p', { className: 'dshxs-note' }, t('liveNote')),
        )
      : null,
  )
}

/**
 * Cordis plugin entry point for the browser half.
 *
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }),
    `${PLUGIN_NAME}: dictionaries`,
  )
  const tFallback = ctx.locale.bind(NS)

  const scope = ctx.settingsScope.bind({ namespace: NS })
  const store = makeStore(scope)

  injectStyles()

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: () => ({ hooks: { crossSession: store }, scope }),
      },
      (props: {
        readonly t?: (key: string) => string
        readonly useCrossSession?: (
          selector: (snapshot: Record<string, unknown>) => Record<string, unknown>,
        ) => Record<string, unknown> | undefined
      }): ReactNode => createElement(CrossSessionCard, { ...props, tFallback, scope }),
    ),
  )
}

/** Cordis plugin metadata consumed by the client module system. */
export const name = PLUGIN_NAME

/**
 * Required services (cordis fiber inject): the slot registry, the locale
 * service for card strings, and the settings scope that backs every control.
 * Service names, not package names — `dsh.client.inject` in `package.json` is
 * what orders their providers before this bundle.
 */
export const inject = ['slots', 'locale', 'settingsScope'] as const

export { CrossSessionCard }
