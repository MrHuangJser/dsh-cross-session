/**
 * Package identity shared by both halves of the plugin.
 *
 * `SETTINGS_NAMESPACE` is the single key that ties three things together: the
 * Host settings section, the browser settings card registered into
 * `settings.plugin.item`, and any composition row config. Changing it silently
 * detaches the card from its namespace, so it is defined exactly once.
 */

/** Lowercase hyphenated settings namespace, per the settings document's rules. */
export const SETTINGS_NAMESPACE = 'cross-session' as const

/** Host plugin name, used by the Cordis loader and by log lines. */
export const PLUGIN_NAME = '@mrhuangjser/dsh-cross-session' as const

/** Model-facing tool names. Stable: sessions and prompts may cite them. */
export const TOOL_LIST = 'sessions_list' as const
export const TOOL_READ = 'sessions_read' as const
export const TOOL_SEND = 'sessions_send' as const

/** Every tool this package registers, in registration order. */
export const TOOL_NAMES = [TOOL_LIST, TOOL_READ, TOOL_SEND] as const

export type ToolName = (typeof TOOL_NAMES)[number]
