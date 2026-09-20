import { createElement } from "react";

//#region src/shared/meta.ts
/**
* Package identity shared by both halves of the plugin.
*
* `SETTINGS_NAMESPACE` is the single key that ties three things together: the
* Host settings section, the browser settings card registered into
* `settings.plugin.item`, and any composition row config. Changing it silently
* detaches the card from its namespace, so it is defined exactly once.
*/
/** Lowercase hyphenated settings namespace, per the settings document's rules. */
const SETTINGS_NAMESPACE = "cross-session";
/** Host plugin name, used by the Cordis loader and by log lines. */
const PLUGIN_NAME = "dsh-cross-session";

//#endregion
//#region src/shared/settings.ts
/**
* Composition-level defaults.
*
* These are the values a deployment gets with no settings document entry at
* all. They are intentionally conservative on volume and permissive on
* capability, because a tool that cannot act is indistinguishable from a
* broken install.
*/
const DEFAULT_SETTINGS = {
	enabled: true,
	defaultSendMode: "queue",
	allowResume: true,
	frameMessages: true,
	includeInjectedByDefault: false,
	maxListResults: 25,
	maxReadMessages: 12,
	maxMessageChars: 1200,
	maxSendChars: 4e3
};

//#endregion
//#region src/client/index.ts
const FIELDS = [
	{
		key: "enabled",
		label: "Enable cross-session tools",
		hint: "Registers sessions_list, sessions_read, and sessions_send for every session.",
		kind: "boolean"
	},
	{
		key: "defaultSendMode",
		label: "Default delivery mode",
		hint: "queue delivers as the target next turn; steer inserts into the turn it is running now.",
		kind: "mode"
	},
	{
		key: "allowResume",
		label: "Allow waking cold sessions",
		hint: "When off, sending to a session that is not live is refused and nothing is resumed.",
		kind: "boolean"
	},
	{
		key: "frameMessages",
		label: "Frame delivered messages",
		hint: "Prefixes each message with the sending session, so the receiver can tell a peer from the human.",
		kind: "boolean"
	},
	{
		key: "includeInjectedByDefault",
		label: "Include harness-injected context when reading",
		hint: "System reminders and memory snapshots are hidden by default because they are not what a session discussed.",
		kind: "boolean"
	},
	{
		key: "maxListResults",
		label: "Max sessions listed",
		hint: "Upper bound on rows sessions_list returns.",
		kind: "number"
	},
	{
		key: "maxReadMessages",
		label: "Max messages read",
		hint: "Upper bound on messages sessions_read returns.",
		kind: "number"
	},
	{
		key: "maxMessageChars",
		label: "Characters per read message",
		hint: "Per-message budget before a read truncates.",
		kind: "number"
	},
	{
		key: "maxSendChars",
		label: "Characters per sent message",
		hint: "Upper bound on a delivered message body.",
		kind: "number"
	}
];
/** Read the settings scope service, or `undefined` when this shell has none. */
function settingsScopeOf(ctx) {
	const found = ctx.get("settingsScope");
	if (typeof found !== "object" || found === null) return void 0;
	const scope = found;
	if (typeof scope.bind !== "function") return void 0;
	return scope.bind({ namespace: SETTINGS_NAMESPACE });
}
/** Read the slot registry, or `undefined` when this shell has none. */
function slotsOf(ctx) {
	const found = ctx.get("slots");
	if (typeof found !== "object" || found === null) return void 0;
	const slots = found;
	return typeof slots.inject === "function" ? slots : void 0;
}
/** Read one field's current value, falling back to the documented default. */
function currentValue(scope, key) {
	const fallback = DEFAULT_SETTINGS[key];
	if (scope === void 0) return fallback;
	try {
		const section = scope.get();
		const value = section[key];
		return value === void 0 ? fallback : value;
	} catch {
		return fallback;
	}
}
/** Render one editable row. */
function renderField(spec, scope) {
	const id = `${SETTINGS_NAMESPACE}-${spec.key}`;
	const value = currentValue(scope, spec.key);
	let control;
	if (spec.kind === "boolean") control = createElement("input", {
		id,
		type: "checkbox",
		checked: value === true,
		disabled: scope === void 0,
		onChange: () => {
			scope?.set(spec.key, value !== true);
		}
	});
	else if (spec.kind === "mode") control = createElement("select", {
		id,
		value: typeof value === "string" ? value : DEFAULT_SETTINGS.defaultSendMode,
		disabled: scope === void 0,
		onChange: (event) => {
			scope?.set(spec.key, event.target.value);
		}
	}, createElement("option", {
		key: "queue",
		value: "queue"
	}, "queue"), createElement("option", {
		key: "steer",
		value: "steer"
	}, "steer"));
	else control = createElement("input", {
		id,
		type: "number",
		value: typeof value === "number" ? value : Number(DEFAULT_SETTINGS[spec.key]),
		disabled: scope === void 0,
		onChange: (event) => {
			const parsed = Number(event.target.value);
			if (Number.isFinite(parsed)) scope?.set(spec.key, parsed);
		}
	});
	return createElement("div", {
		key: spec.key,
		className: "cross-session-field"
	}, createElement("label", { htmlFor: id }, createElement("span", { className: "cross-session-field-label" }, spec.label), control), createElement("p", { className: "cross-session-field-hint" }, spec.hint));
}
/** The card component the shell renders inside `settings.plugin.item`. */
function CrossSessionCard() {
	const scope = CrossSessionCard.scope;
	return createElement("div", { className: "cross-session-card" }, createElement("p", { className: "cross-session-intro" }, "Lets one session list, read, and message other sessions of this harness. Sending wakes a cold session only when \"Allow waking cold sessions\" is on."), ...FIELDS.map((spec) => renderField(spec, scope)), createElement("p", { className: "cross-session-footnote" }, scope === void 0 ? "The settings service is unavailable in this shell; values shown are the composed defaults." : `Settings apply live. Namespace: ${SETTINGS_NAMESPACE}.`));
}
/**
* Cordis plugin entry point for the browser half.
*
* @param ctx - the client plugin context.
*/
function apply(ctx) {
	const scope = settingsScopeOf(ctx);
	if (scope === void 0) ctx.logger.warn(`${PLUGIN_NAME}: the client settings service is not composed, so the settings card is not registered.`);
	const slots = slotsOf(ctx);
	if (slots === void 0) {
		ctx.logger.warn(`${PLUGIN_NAME}: the client slot service is not composed; no UI registered.`);
		return;
	}
	slots.inject("settings.plugin.item", () => ({
		name: "settings.plugin.item",
		key: SETTINGS_NAMESPACE,
		inject: () => ({ scope })
	}));
}
/** Cordis plugin metadata consumed by the client module system. */
const name = PLUGIN_NAME;
/** Client services this bundle resolves before running. */
const inject = ["slots"];

//#endregion
export { CrossSessionCard, apply, inject, name };