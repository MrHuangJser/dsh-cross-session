import type { Context, Disposer } from '@deepseek-ai/cordis'
import type { SchemaFactory } from '@deepseek-ai/schemastery'
import type { SettingsProvider, SettingsSchema } from '@deepseek-ai/dsh-settings'

import { PLUGIN_NAME, SETTINGS_NAMESPACE } from './shared/meta.ts'
import { type CrossSessionSettings, DEFAULT_SETTINGS, resolveSettings } from './shared/settings.ts'
import { resolveHostServices } from './host/services.ts'
import { type ToolContext, registerTools } from './host/tools.ts'

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
export type Config = Readonly<Record<string, unknown>>

/** Build the settings section schema, including the GUI-facing descriptions. */
function buildSectionSchema(Schema: SchemaFactory): SettingsSchema<CrossSessionSettings> {
  return Schema.object<SettingsSchema<CrossSessionSettings>>({
    enabled: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.enabled,
      description: 'Register the cross-session tools at all.',
    },
    defaultSendMode: {
      type: 'string',
      default: DEFAULT_SETTINGS.defaultSendMode,
      description: 'Delivery mode used when sessions_send omits mode: queue or steer.',
    },
    allowResume: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.allowResume,
      description:
        'Allow a send to wake a cold session. Off means sessions_read stays read-only and nothing is ever resumed.',
    },
    frameMessages: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.frameMessages,
      description:
        'Prefix delivered messages with a frame naming the sending session, so the receiver can tell a peer from the human.',
    },
    includeInjectedByDefault: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.includeInjectedByDefault,
      description:
        'Include harness-injected context (system reminders, memory snapshots) when reading another session.',
    },
    maxListResults: {
      type: 'number',
      default: DEFAULT_SETTINGS.maxListResults,
      description: 'Upper bound on rows sessions_list returns.',
    },
    maxReadMessages: {
      type: 'number',
      default: DEFAULT_SETTINGS.maxReadMessages,
      description: 'Upper bound on messages sessions_read returns.',
    },
    maxMessageChars: {
      type: 'number',
      default: DEFAULT_SETTINGS.maxMessageChars,
      description: 'Per-message character budget before sessions_read truncates.',
    },
    maxSendChars: {
      type: 'number',
      default: DEFAULT_SETTINGS.maxSendChars,
      description: 'Upper bound on the body length sessions_send delivers.',
    },
  })
}

/**
 * Cordis plugin entry point for the Host half.
 *
 * @param ctx - the plugin context, which owns every registration this makes.
 * @param config - the composition row's own configuration, used as the base layer.
 * @returns a disposer that unregisters everything, or nothing when registration
 *   is owned by `ctx.effect`.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<Disposer | undefined> {
  const services = resolveHostServices(ctx)

  // The active configuration. It starts as the composition row's own values and
  // is replaced by the settings document's resolved scope the moment one
  // attaches, so a GUI edit takes effect without reloading the plugin.
  let currentSource: () => CrossSessionSettings = () => resolveSettings(config)

  const toolContext: ToolContext = {
    query: services.query,
    controller: services.controller,
    agents: services.agents,
    settings: () => {
      const resolved = currentSource()
      return resolved.enabled ? resolved : { ...resolved, enabled: false }
    },
  }

  const disposeTools = registerTools(ctx, services.tools, toolContext)

  // The settings section is optional: a minimal composition that mounts only the
  // tools keeps working, with the row's own config as the whole configuration.
  const provider = ctx.get('settings') as SettingsProvider | undefined
  if (provider === undefined) {
    ctx.logger.info(
      `${PLUGIN_NAME}: no settings provider in this composition; using static configuration only`,
    )
    return disposeTools
  }

  let Schema: SchemaFactory
  try {
    const module = await import('@deepseek-ai/schemastery')
    Schema = module.default
  } catch (error) {
    ctx.logger.warn(
      `${PLUGIN_NAME}: @deepseek-ai/schemastery could not be resolved, so the ` +
        `${SETTINGS_NAMESPACE} settings section is not declared and only static configuration ` +
        `applies. Install it in the profile to get the settings card: ${String(error)}`,
    )
    return disposeTools
  }

  provider.installSection(
    ctx,
    SETTINGS_NAMESPACE,
    buildSectionSchema(Schema),
    resolveSettings(config),
    {
      setSource: (source): void => {
        currentSource = (): CrossSessionSettings => resolveSettings(source())
      },
      onChange: (): void => {
        ctx.logger.debug(`${PLUGIN_NAME}: ${SETTINGS_NAMESPACE} settings changed`)
      },
    },
  )

  ctx.logger.info(
    `${PLUGIN_NAME}: registered sessions_list, sessions_read, sessions_send (namespace ${SETTINGS_NAMESPACE})`,
  )

  return disposeTools
}

/** Cordis plugin metadata consumed by the loader. */
export const name = PLUGIN_NAME

/** Hard dependencies: without these the tools cannot do their job at all. */
export const inject = ['sessionQuery', 'sessionController', 'agents', 'tools'] as const

export { SETTINGS_NAMESPACE }
export type { CrossSessionSettings }
