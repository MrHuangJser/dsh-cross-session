window.__ModuleLoader__.load({
	id: "@huangjiangheng/dsh-cross-session",
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
		const PLUGIN_NAME = "@huangjiangheng/dsh-cross-session";

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
		/**
		* The browser half of @huangjiangheng/dsh-cross-session: one expandable card in **Settings →
		* Plugins → Plugin configuration**.
		*
		* The card is dispatched by the section that owns `settings.plugin.item`, keyed
		* by the settings namespace this package declares on the Host. Registering the
		* card under `SETTINGS_NAMESPACE` is what makes the Host section visible in the
		* GUI at all: the section renders the intersection of the namespaces the Host
		* serves and the cards registered here, so neither half alone shows anything.
		*/
		/** Dictionary namespace for this plugin's strings. */
		const NS = SETTINGS_NAMESPACE;
		const DICT_ZH = {
			title: "跨会话",
			desc: "让一个会话列出、读取并给其他会话发消息。",
			intro: "跨会话能力让一个会话可以发现、读取并向其他顶层会话投递消息。冷会话只有开启「允许唤醒冷会话」才会被唤醒。",
			expand: "展开",
			collapse: "收起",
			readOnly: "此部署的 settings 只读，显示值为组合默认。",
			unavailable: "settings 服务在此 shell 不可用，显示值为组合默认。",
			fieldEnabled: "启用跨会话工具",
			hintEnabled: "注册 sessions_list、sessions_read、sessions_send。",
			fieldDefaultSendMode: "默认投递模式",
			hintDefaultSendMode: "queue 作为对方下一轮投递；steer 插入对方当前轮次。",
			fieldAllowResume: "允许唤醒冷会话",
			hintAllowResume: "关闭时，向未加载会话发送会被拒绝，绝不唤醒。",
			fieldFrameMessages: "为投递消息加框",
			hintFrameMessages: "在消息前加上发送方会话标识，便于对方回复。",
			fieldIncludeInjected: "读取时包含注入上下文",
			hintIncludeInjected: "默认隐藏系统提醒、记忆快照等 harness 注入内容。",
			fieldMaxListResults: "列出会话上限",
			hintMaxListResults: "sessions_list 返回的最大行数。",
			fieldMaxReadMessages: "读取消息上限",
			hintMaxReadMessages: "sessions_read 返回的最大消息数。",
			fieldMaxMessageChars: "单条消息字符上限",
			hintMaxMessageChars: "读取时超过即截断。",
			fieldMaxSendChars: "发送消息字符上限",
			hintMaxSendChars: "投递正文的最大长度。",
			liveNote: "设置实时生效。命名空间：cross-session。"
		};
		const DICT_EN = {
			title: "Cross-session",
			desc: "Let one session list, read, and message other sessions.",
			intro: "Cross-session tools let one conversation discover, read, and deliver messages to other top-level sessions. A cold session is only woken when \"Allow waking cold sessions\" is on.",
			expand: "Expand",
			collapse: "Collapse",
			readOnly: "The settings document is read-only in this deployment; shown values are the composed defaults.",
			unavailable: "The settings service is unavailable in this shell; shown values are the composed defaults.",
			fieldEnabled: "Enable cross-session tools",
			hintEnabled: "Registers sessions_list, sessions_read, and sessions_send.",
			fieldDefaultSendMode: "Default delivery mode",
			hintDefaultSendMode: "queue delivers as the target next turn; steer inserts into the turn it is running now.",
			fieldAllowResume: "Allow waking cold sessions",
			hintAllowResume: "When off, sending to a session that is not live is refused and nothing is resumed.",
			fieldFrameMessages: "Frame delivered messages",
			hintFrameMessages: "Prefixes each message with the sending session, so the receiver can tell a peer from the human.",
			fieldIncludeInjected: "Include harness-injected context when reading",
			hintIncludeInjected: "System reminders and memory snapshots are hidden by default because they are not what a session discussed.",
			fieldMaxListResults: "Max sessions listed",
			hintMaxListResults: "Upper bound on rows sessions_list returns.",
			fieldMaxReadMessages: "Max messages read",
			hintMaxReadMessages: "Upper bound on messages sessions_read returns.",
			fieldMaxMessageChars: "Characters per read message",
			hintMaxMessageChars: "Per-message budget before a read truncates.",
			fieldMaxSendChars: "Characters per sent message",
			hintMaxSendChars: "Upper bound on a delivered message body.",
			liveNote: "Settings apply live. Namespace: cross-session."
		};
		const FIELDS = [
			{
				key: "enabled",
				labelKey: "fieldEnabled",
				hintKey: "hintEnabled",
				kind: "boolean"
			},
			{
				key: "defaultSendMode",
				labelKey: "fieldDefaultSendMode",
				hintKey: "hintDefaultSendMode",
				kind: "mode"
			},
			{
				key: "allowResume",
				labelKey: "fieldAllowResume",
				hintKey: "hintAllowResume",
				kind: "boolean"
			},
			{
				key: "frameMessages",
				labelKey: "fieldFrameMessages",
				hintKey: "hintFrameMessages",
				kind: "boolean"
			},
			{
				key: "includeInjectedByDefault",
				labelKey: "fieldIncludeInjected",
				hintKey: "hintIncludeInjected",
				kind: "boolean"
			},
			{
				key: "maxListResults",
				labelKey: "fieldMaxListResults",
				hintKey: "hintMaxListResults",
				kind: "number"
			},
			{
				key: "maxReadMessages",
				labelKey: "fieldMaxReadMessages",
				hintKey: "hintMaxReadMessages",
				kind: "number"
			},
			{
				key: "maxMessageChars",
				labelKey: "fieldMaxMessageChars",
				hintKey: "hintMaxMessageChars",
				kind: "number"
			},
			{
				key: "maxSendChars",
				labelKey: "fieldMaxSendChars",
				hintKey: "hintMaxSendChars",
				kind: "number"
			}
		];
		/** Build the inject-time store over the bound scope. */
		function makeStore(scope) {
			let snapshot = {};
			const read = () => {
				try {
					const value = typeof scope.get === "function" ? scope.get() : void 0;
					if (typeof value === "object" && value !== null) snapshot = value;
				} catch {}
				return snapshot;
			};
			read();
			return {
				subscribe(listener) {
					return scope.subscribe(() => {
						read();
						listener();
					});
				},
				getSnapshot() {
					return read();
				}
			};
		}
		/** Write one field, then re-sync the snapshot regardless of the commit result. */
		function writeField(scope, key, value) {
			try {
				const result = scope.set(key, value);
				if (result !== void 0 && typeof result.catch === "function") result.catch(() => void 0);
			} catch {}
		}
		/** The card's stylesheet, injected once per document beside shipped plugin CSS. */
		const CARD_CSS = ".dshxs-card{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;list-style:none}.dshxs-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dshxs-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dshxs-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dshxs-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dshxs-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .2s ease-in-out;flex:none;font-size:12px}.dshxs-open .dshxs-chevron{transform:rotate(180deg)}.dshxs-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 12px}.dshxs-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;margin:8px 0}.dshxs-field{display:flex;flex-direction:column;gap:4px;padding:8px 0}.dshxs-field+.dshxs-field{border-top:.5px solid var(--dsw-alias-border-l2)}.dshxs-field label{display:flex;align-items:center;justify-content:space-between;gap:12px}.dshxs-field-label{color:var(--dsw-alias-label-primary);font-size:14px}.dshxs-field input[type=checkbox]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}.dshxs-field input[type=number],.dshxs-field select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-3));border:.5px solid var(--dsw-alias-border-l4);border-radius:14px;height:30px;padding:0 10px;min-width:120px}.dshxs-field-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}.dshxs-note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:12px 0 4px}";
		function injectStyles() {
			if (typeof document === "undefined") return;
			const tagId = `${NS}/card.css`;
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset["plugin"] = PLUGIN_NAME;
			tag.dataset["pluginCss"] = tagId;
			tag.textContent = CARD_CSS;
			document.head.appendChild(tag);
		}
		/** One editable row. */
		function renderField(spec, t, value, disabled, scope) {
			const id = `${NS}-${spec.key}`;
			const fallback = DEFAULT_SETTINGS[spec.key];
			let control;
			if (spec.kind === "boolean") control = (0, react.createElement)("input", {
				id,
				type: "checkbox",
				checked: value === true,
				disabled: disabled || scope === void 0,
				onChange: () => {
					if (scope !== void 0) writeField(scope, spec.key, value !== true);
				}
			});
			else if (spec.kind === "mode") control = (0, react.createElement)("select", {
				id,
				value: typeof value === "string" ? value : String(fallback),
				disabled: disabled || scope === void 0,
				onChange: (event) => {
					if (scope !== void 0) writeField(scope, spec.key, event.target.value);
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
				value: typeof value === "number" ? value : Number(fallback),
				disabled: disabled || scope === void 0,
				onChange: (event) => {
					const parsed = Number(event.target.value);
					if (scope !== void 0 && Number.isFinite(parsed)) writeField(scope, spec.key, parsed);
				}
			});
			return (0, react.createElement)("div", {
				key: spec.key,
				className: "dshxs-field"
			}, (0, react.createElement)("label", { htmlFor: id }, (0, react.createElement)("span", { className: "dshxs-field-label" }, t(spec.labelKey)), control), (0, react.createElement)("p", { className: "dshxs-field-hint" }, t(spec.hintKey)));
		}
		/** The card component registered into `settings.plugin.item`. */
		function CrossSessionCard(props) {
			const t = props.t ?? props.tFallback ?? ((key) => key);
			const [open, setOpen] = (0, react.useState)(false);
			const snapshot = typeof props.useCrossSession === "function" ? props.useCrossSession((s) => s) : void 0;
			const scope = props.scope;
			const disabled = scope === void 0;
			const valueOf = (key) => {
				const fromScope = snapshot === void 0 ? void 0 : snapshot[key];
				return fromScope === void 0 ? DEFAULT_SETTINGS[key] : fromScope;
			};
			return (0, react.createElement)("li", { className: "dshxs-card" + (open ? " dshxs-open" : "") }, (0, react.createElement)("button", {
				type: "button",
				className: "dshxs-head",
				"aria-expanded": open,
				onClick: () => {
					setOpen(!open);
				}
			}, (0, react.createElement)("span", { className: "dshxs-headtext" }, (0, react.createElement)("span", { className: "dshxs-name" }, t("title")), (0, react.createElement)("span", { className: "dshxs-desc" }, t("desc"))), (0, react.createElement)("span", { className: "dshxs-chevron" }, "⌄")), open ? (0, react.createElement)("div", { className: "dshxs-body" }, (0, react.createElement)("p", { className: "dshxs-intro" }, t("intro")), scope === void 0 ? (0, react.createElement)("p", {
				className: "dshxs-note",
				role: "status"
			}, t("unavailable")) : null, ...FIELDS.map((spec) => renderField(spec, t, valueOf(spec.key), disabled, scope)), (0, react.createElement)("p", { className: "dshxs-note" }, t("liveNote"))) : null);
		}
		/**
		* Cordis plugin entry point for the browser half.
		*
		* @param ctx - the client plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh: DICT_ZH,
				en: DICT_EN
			}), `${PLUGIN_NAME}: dictionaries`);
			const tFallback = ctx.locale.bind(NS);
			const scope = ctx.settingsScope.bind({ namespace: NS });
			const store = makeStore(scope);
			injectStyles();
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NS,
				locale: NS,
				inject: () => ({
					hooks: { crossSession: store },
					scope
				})
			}, (props) => (0, react.createElement)(CrossSessionCard, {
				...props,
				tFallback,
				scope
			})));
		}
		/** Cordis plugin metadata consumed by the client module system. */
		const name = PLUGIN_NAME;
		/**
		* Required services (cordis fiber inject): the slot registry, the locale
		* service for card strings, and the settings scope that backs every control.
		* Service names, not package names — `dsh.client.inject` in `package.json` is
		* what orders their providers before this bundle.
		*/
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];

		//#endregion
		exports.CrossSessionCard = CrossSessionCard
		exports.apply = apply
		exports.inject = inject
		exports.name = name
		return module.exports;
	}
});
