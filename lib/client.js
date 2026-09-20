window.__ModuleLoader__.load({
	id: "dsh-cross-session",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		"use strict";
		//#region rolldown:runtime
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));

		//#endregion
		const react = __toESM(require("react"));

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
		/**
		* Read a service defensively: `ctx.get` first, the direct property as fallback.
		*
		* The caller names the shape it expects — a shell that supplies a different
		* implementation under the same key is out of contract, and the card degrades
		* to composed defaults rather than throwing in render.
		*/
		function serviceOf(ctx, name$1) {
			const viaGet = ctx.get(name$1);
			if (viaGet !== void 0 && viaGet !== null) return viaGet;
			return ctx[name$1];
		}
		/** Read the settings scope service, or `undefined` when this shell has none. */
		function scopeOf(ctx) {
			const binder = serviceOf(ctx, "settingsScope");
			if (binder === void 0 || typeof binder.bind !== "function") return void 0;
			try {
				return binder.bind({ namespace: SETTINGS_NAMESPACE });
			} catch {
				return void 0;
			}
		}
		/** Read the slot registry, or `undefined` when this shell has none. */
		function slotsOf(ctx) {
			return serviceOf(ctx, "slots");
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
			const disabled = scope === void 0;
			let control;
			if (spec.kind === "boolean") control = (0, react.createElement)("input", {
				id,
				type: "checkbox",
				checked: value === true,
				disabled,
				onChange: () => {
					scope?.set(spec.key, value !== true);
				}
			});
			else if (spec.kind === "mode") control = (0, react.createElement)("select", {
				id,
				value: typeof value === "string" ? value : DEFAULT_SETTINGS.defaultSendMode,
				disabled,
				onChange: (event) => {
					scope?.set(spec.key, event.target.value);
				}
			}, (0, react.createElement)("option", {
				key: "queue",
				value: "queue"
			}, "queue"), (0, react.createElement)("option", {
				key: "steer",
				value: "steer"
			}, "steer"));
			else control = (0, react.createElement)("input", {
				id,
				type: "number",
				value: typeof value === "number" ? value : Number(DEFAULT_SETTINGS[spec.key]),
				disabled,
				onChange: (event) => {
					const parsed = Number(event.target.value);
					if (Number.isFinite(parsed)) scope?.set(spec.key, parsed);
				}
			});
			return (0, react.createElement)("div", {
				key: spec.key,
				className: "dshxs-field"
			}, (0, react.createElement)("label", { htmlFor: id }, (0, react.createElement)("span", { className: "dshxs-field-label" }, spec.label), control), (0, react.createElement)("p", { className: "dshxs-field-hint" }, spec.hint));
		}
		/**
		* The card component.
		*
		* The section supplies no owner props for `settings.plugin.item`, so the scope
		* the card edits is captured through `inject` rather than read inside render.
		*/
		function CrossSessionCard(props) {
			const scope = props.scope;
			return (0, react.createElement)("div", { className: "dshxs-card" }, (0, react.createElement)("p", { className: "dshxs-intro" }, "Lets one session list, read, and message other sessions of this harness. Sending wakes a cold session only when \"Allow waking cold sessions\" is on."), ...FIELDS.map((spec) => renderField(spec, scope)), (0, react.createElement)("p", { className: "dshxs-footnote" }, scope === void 0 ? "The settings service is unavailable in this shell; values shown are the composed defaults." : `Settings apply live. Namespace: ${SETTINGS_NAMESPACE}.`));
		}
		/**
		* The stylesheet this card injects.
		*
		* Shipped client plugins inject their CSS as a `<style data-plugin-css>` tag in
		* the document head; this follows the same shape so the tag is reclaimed with
		* the module rather than accumulating.
		*/
		const CARD_CSS = ".dshxs-card{display:flex;flex-direction:column;gap:4px}.dshxs-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;margin:0 0 8px}.dshxs-field{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2)}.dshxs-field:first-of-type{border-top:none}.dshxs-field label{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer}.dshxs-field-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}.dshxs-field input[type=checkbox]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}.dshxs-field input[type=number],.dshxs-field select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;height:30px;padding:0 10px;min-width:120px}.dshxs-field-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}.dshxs-footnote{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:8px 0 0}";
		/** Attach the card's stylesheet once per document. */
		function injectStyles() {
			if (typeof document === "undefined") return;
			const tagId = `${SETTINGS_NAMESPACE}/card.css`;
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset["plugin"] = PLUGIN_NAME;
			tag.dataset["pluginCss"] = tagId;
			tag.textContent = CARD_CSS;
			document.head.appendChild(tag);
		}
		/**
		* Cordis plugin entry point for the browser half.
		*
		* @param ctx - the client plugin context.
		*/
		function apply(ctx) {
			const scope = scopeOf(ctx);
			if (scope === void 0) ctx.logger.warn(`${PLUGIN_NAME}: the client settings service is not composed; the card will show composed defaults.`);
			const slots = slotsOf(ctx);
			if (slots === void 0) {
				ctx.logger.warn(`${PLUGIN_NAME}: the client slot service is not composed; no UI registered.`);
				return;
			}
			injectStyles();
			slots.inject("settings.plugin.item", () => ({
				name: "settings.plugin.item",
				key: SETTINGS_NAMESPACE,
				inject: () => ({ scope })
			}));
		}
		/** Cordis plugin metadata consumed by the client module system. */
		const name = PLUGIN_NAME;
		/**
		* Required services (cordis fiber inject).
		*
		* Both are provided by `@deepseek-ai/dsh-client-ui-settings` and the slot core.
		* Service names, not package names: the package-level `dsh.client.inject` in
		* `package.json` is what orders those providers before this bundle.
		*/
		const inject = ["settingsScope", "slots"];

		//#endregion
		exports.CrossSessionCard = CrossSessionCard
		exports.apply = apply
		exports.inject = inject
		exports.name = name
		return module.exports;
	}
});
