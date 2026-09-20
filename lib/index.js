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
/** Model-facing tool names. Stable: sessions and prompts may cite them. */
const TOOL_LIST = "sessions_list";
const TOOL_READ = "sessions_read";
const TOOL_SEND = "sessions_send";

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
/**
* Inclusive bounds for every numeric setting.
*
* Applied on top of schema validation because a composition row can supply a
* value that never travelled through the settings document.
*/
const LIMITS = {
	maxListResults: {
		min: 1,
		max: 200
	},
	maxReadMessages: {
		min: 1,
		max: 100
	},
	maxMessageChars: {
		min: 100,
		max: 2e4
	},
	maxSendChars: {
		min: 100,
		max: 4e4
	}
};
/**
* Clamp one numeric setting into its supported range.
*
* A non-finite or non-numeric value falls back to the default rather than
* throwing: configuration is user input, and a plugin that refuses to load
* over a typo is worse than one that logs and continues.
*/
function clamp(name$1, value) {
	const fallback = DEFAULT_SETTINGS[name$1];
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const { min, max } = LIMITS[name$1];
	return Math.min(max, Math.max(min, Math.trunc(value)));
}
/** Narrow an unknown value to a delivery mode, falling back to the default. */
function normalizeSendMode(value) {
	return value === "steer" || value === "queue" ? value : DEFAULT_SETTINGS.defaultSendMode;
}
/** Narrow an unknown value to a boolean, falling back to the default. */
function booleanOr(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
/**
* Fold a partially-known configuration into a fully valid one.
*
* Accepts `unknown` on purpose: the input may come from a composition row, from
* the settings document, or from a test. Nothing in this function throws.
*/
function resolveSettings(input) {
	const raw = typeof input === "object" && input !== null ? input : {};
	return {
		enabled: booleanOr(raw["enabled"], DEFAULT_SETTINGS.enabled),
		defaultSendMode: normalizeSendMode(raw["defaultSendMode"]),
		allowResume: booleanOr(raw["allowResume"], DEFAULT_SETTINGS.allowResume),
		frameMessages: booleanOr(raw["frameMessages"], DEFAULT_SETTINGS.frameMessages),
		includeInjectedByDefault: booleanOr(raw["includeInjectedByDefault"], DEFAULT_SETTINGS.includeInjectedByDefault),
		maxListResults: clamp("maxListResults", raw["maxListResults"]),
		maxReadMessages: clamp("maxReadMessages", raw["maxReadMessages"]),
		maxMessageChars: clamp("maxMessageChars", raw["maxMessageChars"]),
		maxSendChars: clamp("maxSendChars", raw["maxSendChars"])
	};
}

//#endregion
//#region src/host/services.ts
/**
* The consumed services, keyed by the service name.
*
* Keeping the reason beside the name means the boot-time diagnostic can say
* what stopped working, which is the difference between a five-minute and a
* one-hour debugging session.
*/
const REQUIREMENTS = {
	sessionQuery: "read other sessions without waking them",
	sessionController: "deliver a message into another session",
	agents: "resolve the calling session identity",
	tools: "register the model-facing tools"
};
/** Look up the documented purpose of a required service. */
function purposeOf(name$1) {
	return REQUIREMENTS[name$1];
}
/** Every requirement as a list, for diagnostics and tests. */
const REQUIREMENTS_LIST = Object.entries(REQUIREMENTS).map(([name$1, purpose]) => ({
	name: name$1,
	purpose
}));
/** Thrown when a required Host service is absent from this composition. */
var MissingServiceError = class extends Error {
	service;
	constructor(service, purpose) {
		super(`dsh-cross-session requires the "${service}" Host service (${purpose}), but this deployment does not compose it. Add the plugin that provides "${service}" to the host composition, or disable this plugin.`);
		this.name = "MissingServiceError";
		this.service = service;
	}
};
/**
* Resolve one required service.
*
* `ctx.get` is typed as returning `unknown`, so the caller states the shape it
* expects; a deployment that composes a different implementation of the same
* service key is out of contract, and the tool bodies fail loudly rather than
* silently when that happens.
*/
function requireService(ctx, name$1, purpose) {
	const found = ctx.get(name$1);
	if (found === void 0 || found === null) throw new MissingServiceError(name$1, purpose);
	return found;
}
/**
* Resolve every service the plugin needs, or throw naming the first missing one.
*
* Called at apply time so a misconfigured deployment fails loudly at mount
* rather than when a model first calls a tool.
*/
function resolveHostServices(ctx) {
	return {
		query: requireService(ctx, "sessionQuery", purposeOf("sessionQuery")),
		controller: requireService(ctx, "sessionController", purposeOf("sessionController")),
		agents: requireService(ctx, "agents", purposeOf("agents")),
		tools: requireService(ctx, "tools", purposeOf("tools"))
	};
}

//#endregion
//#region src/shared/events.ts
const READABLE_TYPES = [
	"user/message",
	"assistant/message",
	"system/message"
];
/** Whether one raw event type carries conversation this plugin will render. */
function isReadableEventType(type) {
	return READABLE_TYPES.includes(type);
}
/** Map an event type onto the role it represents in the transcript. */
function roleOf(type) {
	switch (type) {
		case "user/message": return "user";
		case "assistant/message": return "assistant";
		case "system/message": return "system";
	}
}
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function isContentBlock(value) {
	return isRecord(value) && typeof value["type"] === "string";
}
/**
* Recover the message object from one event's `data`, whichever shape it uses.
*
* @param data - the raw `data` field of a session event.
* @returns the message, or `undefined` when this event holds none.
*/
function messageOf(data) {
	if (!isRecord(data)) return void 0;
	const directContent = data["content"];
	if (Array.isArray(directContent) && typeof data["role"] === "string") {
		if (!directContent.every(isContentBlock)) return void 0;
		return data;
	}
	const wrapped = data["message"];
	if (isRecord(wrapped) && Array.isArray(wrapped["content"]) && typeof wrapped["role"] === "string") {
		if (!wrapped["content"].every(isContentBlock)) return void 0;
		return wrapped;
	}
	return void 0;
}
/**
* Concatenate only the text blocks of one event.
*
* Reasoning blocks are deliberately dropped: they are model-internal, they
* dominate the byte cost of an assistant turn, and forwarding them would leak
* one session's scratchpad into another's context.
*/
function textOf(data) {
	const message = messageOf(data);
	if (message === void 0) return "";
	return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
}
/** A short, stable label for where a message came from. */
function sourceLabelOf(data) {
	const message = messageOf(data);
	const source = message?.source;
	if (source === void 0) return "unknown";
	switch (source.kind) {
		case "user": return "user";
		case "model": return `model:${source.provider}/${source.model}`;
		case "plugin": return source.form === void 0 ? `plugin:${source.plugin}` : `plugin:${source.plugin}/${source.form}`;
		case "tool": return "tool";
	}
}
/**
* Prefixes that mark a `user/message` as harness-injected context rather than
* something the human typed.
*
* These messages are real session events and are indistinguishable by shape, so
* detection is by content. The list covers the injections the Harness itself
* and the common context plugins perform; it is intentionally a denylist of
* prefixes and never a filter on user text.
*/
const INJECTED_PREFIXES = [
	"<system-reminder>",
	"Current runtime context.",
	"[MNEMON]",
	"MNEMON RUNTIME MEMORY SNAPSHOT"
];
/** Whether one already-extracted message body looks harness-injected. */
function isInjectedText(text$1) {
	const head = text$1.trimStart();
	return INJECTED_PREFIXES.some((prefix) => head.startsWith(prefix));
}
/** Truncate to a character budget, appending a visible marker. */
function clip(text$1, max) {
	if (text$1.length <= max) return text$1;
	return `${text$1.slice(0, max)}…[truncated ${text$1.length - max} chars]`;
}

//#endregion
//#region src/host/sessions-list.ts
function kindOf(record) {
	return record.header.origin === "subagent" ? "subagent" : "top-level";
}
function matchesQuery(summary, needle) {
	if (needle.length === 0) return true;
	const haystack = [
		summary.sessionId,
		summary.title,
		summary.cwd ?? "",
		summary.agentPreset ?? ""
	];
	return haystack.some((field) => field.toLowerCase().includes(needle));
}
/**
* List sessions from the durable corpus plus the live registry.
*
* Titles are folded in one batch because a title is a log-derived value, not a
* header field: asking per session would turn one listing into N log reads.
*
* @param query - the session query service, already resolved by the caller.
* @param request - the caller's identity and filters.
* @param titles - batched title observations, index-aligned with `records`.
* @param records - the raw corpus listing this call should project.
* @returns the projected, ranked summaries plus what was filtered out.
*/
function projectSessions(request, records, titles) {
	const needle = request.query.trim().toLowerCase();
	const summaries = records.map((record, index) => {
		const kind = kindOf(record);
		const title = titles[index];
		return {
			sessionId: String(record.header.id),
			kind,
			live: record.live,
			persisted: record.persisted,
			title: title !== void 0 && title.length > 0 ? title : "(untitled)",
			...record.header.cwd === void 0 ? {} : { cwd: record.header.cwd },
			...record.header.agentPreset === void 0 ? {} : { agentPreset: record.header.agentPreset },
			createdAt: record.header.createdAt,
			isSelf: String(record.header.id) === request.callerId
		};
	});
	const scoped = summaries.filter((summary) => {
		if (request.scope === "top-level") return summary.kind === "top-level";
		if (request.scope === "subagents") return summary.kind === "subagent";
		return true;
	});
	const filtered = scoped.filter((summary) => {
		if (request.liveOnly && !summary.live) return false;
		return matchesQuery(summary, needle);
	});
	const sorted = [...filtered].sort((left, right) => {
		if (left.isSelf !== right.isSelf) return left.isSelf ? 1 : -1;
		return right.createdAt - left.createdAt;
	});
	const limited = sorted.slice(0, request.limit);
	return {
		sessions: limited,
		totalConsidered: scoped.length,
		truncated: sorted.length > limited.length
	};
}
/**
* Read the whole corpus and fold titles for the listed rows.
*
* @param query - the session query service.
* @param request - the caller's filters.
* @param signal - caller cancellation, forwarded to every backend read.
* @returns the projected listing.
*/
async function listSessions(query, request, signal) {
	const records = await query.listSessions(signal);
	const prefiltered = records.filter((record) => {
		if (record.header.origin === "subagent" && request.scope === "top-level") return false;
		if (record.header.origin !== "subagent" && request.scope === "subagents") return false;
		if (request.liveOnly && !record.live) return false;
		return true;
	});
	const observations = await query.readTitleSnapshots(prefiltered.map((record) => record.header.id), signal);
	const titles = observations.map((observation) => observation.status === "fulfilled" ? observation.value.title : void 0);
	return projectSessions(request, prefiltered, titles);
}
/** Render one summary as a single stable line. */
function renderSummary(summary) {
	const flags = [summary.live ? "live" : "cold", summary.kind];
	if (summary.isSelf) flags.push("this session");
	const where = summary.cwd === void 0 ? "" : ` | cwd=${clip(summary.cwd, 48)}`;
	const preset = summary.agentPreset === void 0 ? "" : ` | preset=${summary.agentPreset}`;
	const unreadable = isSummaryMessageable(summary) ? "" : " | not messageable";
	return `- ${summary.sessionId} [${flags.join(", ")}]${where}${preset}${unreadable}\n    ${clip(summary.title, 100)}`;
}
/** Whether a projected summary can receive a message (mirrors {@link isMessageable}). */
function isSummaryMessageable(summary) {
	return summary.kind === "top-level";
}

//#endregion
//#region src/host/sessions-read.ts
/**
* Project one session's *current model surface* into a readable transcript.
*
* The surface is used rather than the raw event log on purpose: it is the exact
* set of messages the session's own model sees right now, it already excludes
* superseded and log-only events, and it costs one backend read instead of one
* read per message.
*
* @param query - the session query service.
* @param request - target session and rendering budgets.
* @param signal - caller cancellation.
* @returns the projected transcript.
* @throws when the session cannot be resolved or its surface fails validation.
*/
async function readSession(query, request, signal) {
	const sessionId = request.sessionId;
	const title = await query.readTitle(sessionId, signal).catch(() => void 0);
	const surface = await query.readSurface(sessionId);
	const collected = [];
	for (const event of surface.events) {
		if (signal.aborted) break;
		if (!isReadableEventType(event.type)) continue;
		const role = roleOf(event.type);
		if (role === "system" && !request.includeSystem) continue;
		const text$1 = textOf(event.data);
		if (text$1.length === 0) continue;
		const injected = isInjectedText(text$1);
		if (injected && !request.includeInjected) continue;
		const surfaceOp = event.surfaceOp;
		const replaced = typeof surfaceOp === "object" && surfaceOp !== null && "op" in surfaceOp ? surfaceOp.op === "replace" : false;
		collected.push({
			seq: Number(event.seq),
			role,
			text: request.markTruncated === false ? text$1 : clip(text$1, request.maxChars),
			source: sourceLabelOf(event.data),
			injected,
			replaced
		});
	}
	const total = collected.length;
	const window = collected.slice(Math.max(0, total - request.maxMessages));
	return {
		sessionId: String(surface.session.id),
		title: title?.title ?? "(untitled)",
		kind: surface.session.origin === "subagent" ? "subagent" : "top-level",
		live: true,
		...surface.session.cwd === void 0 ? {} : { cwd: surface.session.cwd },
		capturedThroughSeq: surface.capturedThroughSeq === null ? null : Number(surface.capturedThroughSeq),
		items: window,
		omitted: total - window.length,
		total
	};
}
/** Render a transcript as the model-facing text block. */
function renderTranscript(transcript) {
	const lines = [];
	const where = transcript.cwd === void 0 ? "" : ` | cwd=${transcript.cwd}`;
	lines.push(`session ${transcript.sessionId} [${transcript.live ? "live" : "cold"}, ${transcript.kind}]${where}`);
	lines.push(`title: ${clip(transcript.title, 120)}`);
	lines.push(`readable messages: ${transcript.total} | captured through seq: ${String(transcript.capturedThroughSeq)}`);
	if (transcript.items.length === 0) {
		lines.push("(no readable conversation in this session)");
		return lines.join("\n");
	}
	for (const item of transcript.items) {
		const marks = [item.source];
		if (item.injected) marks.push("harness-injected");
		if (item.replaced) marks.push("replaced");
		lines.push(`--- ${item.role} (seq ${String(item.seq)}, ${marks.join(", ")}) ---`);
		lines.push(item.text);
	}
	if (transcript.omitted > 0) lines.push(`(${String(transcript.omitted)} earlier messages omitted)`);
	return lines.join("\n");
}

//#endregion
//#region src/host/sessions-send.ts
/**
* Monotonic request-id source.
*
* The id must be unique per admitted message; the controller replays an id it
* has already seen as a no-op, which is a useful retry guard but would silently
* swallow a genuine second message if ids repeated.
*/
let requestCounter = 0;
function nextRequestId() {
	requestCounter += 1;
	return `cross-session-${String(Date.now())}-${String(requestCounter)}`;
}
/**
* Build the model-visible body of a delivered message.
*
* Attribution is the whole point of the frame: the receiving session sees a
* `user` message, so without this header its model cannot tell a peer session
* from the human operator, and cannot address a reply.
*/
function frameMessage(request, body) {
	if (!request.frame) return body;
	const title = request.sender.title === void 0 || request.sender.title.length === 0 ? "" : ` ("${clip(request.sender.title, 60)}")`;
	return [
		"Cross-session message from another session of this harness.",
		`from-session: ${request.sender.sessionId}${title}`,
		`delivery: ${request.mode}`,
		"--- message begins ---",
		body,
		"--- message ends ---"
	].join("\n");
}
/** Decide whether a target exists and may be messaged. Never throws. */
async function preflight(query, targetId) {
	const records = await query.listSessions();
	const record = records.find((candidate) => String(candidate.header.id) === targetId);
	if (record === void 0) return {
		messageable: false,
		wasLive: false,
		rejection: {
			ok: false,
			targetSessionId: targetId,
			code: "not-found",
			reason: `no session with id "${targetId}" exists in this deployment's session corpus. Use sessions_list to find a valid id.`
		}
	};
	if (record.header.parentSession !== void 0 || record.header.origin !== void 0) return {
		messageable: false,
		wasLive: record.live,
		rejection: {
			ok: false,
			targetSessionId: targetId,
			code: "not-messageable",
			reason: `"${targetId}" is a subagent session owned by "${String(record.header.parentSession)}". A session may only message a top-level session; subagent sessions are driven by the agent that owns them.`
		}
	};
	return {
		messageable: true,
		wasLive: record.live
	};
}
/**
* Deliver one message into another session.
*
* Delivery is asynchronous by design: the call resolves when the target's inbox
* accepts the message, never when the target finishes thinking. A reply is
* another explicitly addressed message, not this call's result.
*
* @param query - the session query service, used for the pre-flight target check.
* @param controller - the session controller, which owns resume policy and admission.
* @param request - the framed message request.
* @param signal - the tool call's own cancellation signal.
* @returns a typed outcome; never throws for an expected refusal.
*/
async function sendToSession(query, controller, request, signal) {
	const body = request.body.trim();
	const target = request.targetSessionId.trim();
	if (body.length === 0) return {
		ok: false,
		targetSessionId: target,
		code: "empty-body",
		reason: "the message body is empty; nothing was delivered."
	};
	const verdict = await preflight(query, target);
	if (!verdict.messageable) return verdict.rejection;
	if (!verdict.wasLive && !request.allowResume) return {
		ok: false,
		targetSessionId: target,
		code: "resume-disabled",
		reason: `"${target}" is not live, and this deployment disables waking cold sessions (cross-session.allowResume is false). The session was left untouched.`
	};
	try {
		const resolved = await controller.resolveAgent(target);
		if ("error" in resolved) return {
			ok: false,
			targetSessionId: target,
			code: resolved.error.code === "session/not-found" ? "not-found" : "rejected",
			reason: resolved.error.message
		};
	} catch (error) {
		return {
			ok: false,
			targetSessionId: target,
			code: "rejected",
			reason: `the target session could not be resolved: ${String(error)}`
		};
	}
	const resumed = !verdict.wasLive;
	const clipped = clip(body, request.maxChars);
	const framed = frameMessage(request, clipped);
	try {
		await controller.prompt({
			requestId: nextRequestId(),
			sessionId: target,
			mode: request.mode,
			content: [{
				type: "text",
				text: framed
			}]
		}, signal);
	} catch (error) {
		return {
			ok: false,
			targetSessionId: target,
			code: "rejected",
			reason: `the target session rejected the message: ${String(error)}`
		};
	}
	return {
		ok: true,
		targetSessionId: target,
		mode: request.mode,
		resumed,
		deliveredChars: framed.length
	};
}
/** Render one delivery outcome as the model-facing text block. */
function renderSendOutcome(outcome) {
	if (!outcome.ok) return `NOT delivered to ${outcome.targetSessionId} (${outcome.code}): ${outcome.reason}`;
	const woke = outcome.resumed ? " (woke a cold session)" : "";
	return `accepted for ${outcome.targetSessionId} | mode=${outcome.mode} | chars=${String(outcome.deliveredChars)}${woke}\nThe message is queued in that session's inbox. Its reply will not return through this call; read it later with sessions_read.`;
}

//#endregion
//#region src/host/tools.ts
/**
* The tool layer.
*
* Every tool follows the same three-step shape: read a frozen argument record,
* narrow it into a typed request, delegate to a pure-ish module that owns the
* behaviour. Argument validation never throws — a model calling a tool with a
* bad argument gets a readable refusal, not a stack trace, because a thrown
* error teaches the model nothing about how to correct itself.
*/
/** JSON Schema fragment for one string property. */
function stringProp(description, extra) {
	return {
		type: "string",
		description,
		...extra
	};
}
/** JSON Schema fragment for one boolean property. */
function booleanProp(description) {
	return {
		type: "boolean",
		description
	};
}
/** JSON Schema fragment for one integer property. */
function intProp(description, min, max) {
	return {
		type: "integer",
		description,
		minimum: min,
		maximum: max
	};
}
/** Read a frozen argument record without trusting its shape. */
function argsOf(value) {
	return typeof value === "object" && value !== null ? value : {};
}
/** Read one string argument, or the fallback when absent or not a string. */
function stringArg(args, key, fallback = "") {
	const value = args[key];
	return typeof value === "string" ? value : fallback;
}
/** Read one boolean argument, or the fallback when absent or not a boolean. */
function booleanArg(args, key, fallback) {
	const value = args[key];
	return typeof value === "boolean" ? value : fallback;
}
/** Read one integer argument, clamped into range, or the fallback. */
function intArg(args, key, fallback, min, max) {
	const value = args[key];
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}
/** The text-block content a tool renders. */
function text(value) {
	return value;
}
/** Declare a text-valued output so the registry can validate the canonical value. */
const TEXT_OUTPUT = {
	schema: { type: "string" },
	render: (_args, value) => [{
		type: "text",
		text: typeof value === "string" ? value : JSON.stringify(value)
	}]
};
/**
* Resolve the calling session's identity.
*
* `exec.agent` is authoritative: it is the exact live Agent the registry
* dispatched the call for, and it is what a cross-session call presents as its
* authority credential. It is declared optional because a nested dispatch is
* not guaranteed to carry one, and the live registry is the documented
* fallback for that case.
*/
function callerIdentity(exec, agents) {
	if (exec.agent !== void 0) return exec.agent;
	return agents.currentInitiator();
}
function defineListTool(context) {
	return {
		name: TOOL_LIST,
		description: "List the other sessions of this harness, newest first, with their durable id, title, workspace, and whether they are currently live. Use this to find the id of a session to read or message; ids are the only accepted address.",
		parameters: {
			type: "object",
			properties: {
				query: stringProp("Case-insensitive filter over session ids, titles, and workspace paths. Empty string lists the most recent sessions."),
				scope: stringProp("Which sessions to list. Defaults to top-level.", { enum: [
					"top-level",
					"subagents",
					"all"
				] }),
				live_only: booleanProp("Restrict the listing to sessions that are live right now."),
				limit: intProp("Maximum rows to return.", 1, 200)
			},
			required: [],
			additionalProperties: false
		},
		output: TEXT_OUTPUT,
		execute: async (rawArgs, exec) => {
			const settings = context.settings();
			const args = argsOf(rawArgs);
			const caller = callerIdentity(exec, context.agents);
			if (caller === void 0) return text("Cannot list sessions: this call has no resolvable calling session identity.");
			const scopeRaw = stringArg(args, "scope", "top-level");
			const scope = scopeRaw === "subagents" || scopeRaw === "all" ? scopeRaw : "top-level";
			const request = {
				callerId: String(caller.id),
				query: stringArg(args, "query"),
				scope,
				liveOnly: booleanArg(args, "live_only", false),
				limit: intArg(args, "limit", settings.maxListResults, 1, settings.maxListResults)
			};
			try {
				const result = await listSessions(context.query, request, exec.signal);
				const lines = result.sessions.map((summary) => renderSummary(summary));
				if (lines.length === 0) return text(`(no matching session; ${String(result.totalConsidered)} sessions were considered)`);
				const footer = `\n\n${String(result.sessions.length)} of ${String(result.totalConsidered)} considered sessions` + (result.truncated ? " (more matched than the limit)" : "") + `\nTop-level sessions are messageable with ${TOOL_SEND}; subagent sessions are not.`;
				return text(`${lines.join("\n")}${footer}`);
			} catch (error) {
				return text(`Listing sessions failed: ${String(error)}`);
			}
		}
	};
}
function defineReadTool(context) {
	return {
		name: TOOL_READ,
		description: "Read a bounded, text-only window of another session's current conversation. Returns that session's most recent user and assistant messages, not its full transcript, and never its tool output or reasoning.",
		parameters: {
			type: "object",
			properties: {
				session_id: stringProp("Durable session id, as returned by sessions_list."),
				max_messages: intProp("How many of the most recent messages to include.", 1, 100),
				include_injected: booleanProp("Include harness-injected context (system reminders, memory snapshots). Off by default because it is not what the session actually discussed."),
				include_system: booleanProp("Include plugin-authored system notices. Off by default.")
			},
			required: ["session_id"],
			additionalProperties: false
		},
		output: TEXT_OUTPUT,
		execute: async (rawArgs, exec) => {
			const settings = context.settings();
			const args = argsOf(rawArgs);
			const sessionId = stringArg(args, "session_id").trim();
			if (sessionId.length === 0) return text("Reading a session requires its durable session_id.");
			const request = {
				sessionId,
				maxMessages: intArg(args, "max_messages", settings.maxReadMessages, 1, settings.maxReadMessages),
				maxChars: settings.maxMessageChars,
				includeInjected: booleanArg(args, "include_injected", settings.includeInjectedByDefault),
				includeSystem: booleanArg(args, "include_system", false)
			};
			try {
				const transcript = await readSession(context.query, request, exec.signal);
				return text(renderTranscript(transcript));
			} catch (error) {
				return text(`Reading session "${sessionId}" failed: ${String(error)}. Verify the id with ${TOOL_LIST}.`);
			}
		}
	};
}
function defineSendTool(context) {
	return {
		name: TOOL_SEND,
		description: "Send a message into another top-level session of this harness. Use it to hand work to a peer session or to ask one a question. Delivery is asynchronous: the call returns when the target accepts the message, never with a reply — read the answer later with " + TOOL_READ + ". A subagent session cannot be addressed this way.",
		parameters: {
			type: "object",
			properties: {
				session_id: stringProp("Durable id of the target session, as returned by sessions_list."),
				message: stringProp("The message body to deliver."),
				mode: stringProp("queue delivers the message as the target's next turn (default). steer inserts it into the turn the target is running now.", { enum: ["queue", "steer"] })
			},
			required: ["session_id", "message"],
			additionalProperties: false
		},
		output: TEXT_OUTPUT,
		execute: async (rawArgs, exec) => {
			const settings = context.settings();
			const args = argsOf(rawArgs);
			const targetSessionId = stringArg(args, "session_id").trim();
			if (targetSessionId.length === 0) return text("Sending requires the target session_id.");
			const caller = callerIdentity(exec, context.agents);
			const callerId = caller === void 0 ? "unknown" : String(caller.id);
			const mode = normalizeSendMode(stringArg(args, "mode", settings.defaultSendMode));
			const request = {
				sender: { sessionId: callerId },
				targetSessionId,
				body: stringArg(args, "message"),
				mode,
				allowResume: settings.allowResume,
				frame: settings.frameMessages,
				maxChars: settings.maxSendChars
			};
			const outcome = await sendToSession(context.query, context.controller, request, exec.signal);
			return text(renderSendOutcome(outcome));
		}
	};
}
/**
* Register every tool this plugin contributes.
*
* @param ctx - the plugin context, which owns the registration lifetime.
* @param tools - the Host tool registry.
* @param context - the resolved services and settings accessor for tool bodies.
* @returns one disposer that unregisters all three tools.
*/
function registerTools(ctx, tools, context) {
	const definitions = [
		defineListTool(context),
		defineReadTool(context),
		defineSendTool(context)
	];
	return ctx.effect(() => {
		const disposers = definitions.map((definition) => tools.register(definition));
		return () => {
			for (const dispose of disposers.reverse()) dispose();
		};
	}, "dsh-cross-session: tools");
}

//#endregion
//#region src/index.ts
/** Build the settings section schema, including the GUI-facing descriptions. */
function buildSectionSchema(Schema) {
	return Schema.object({
		enabled: {
			type: "boolean",
			default: DEFAULT_SETTINGS.enabled,
			description: "Register the cross-session tools at all."
		},
		defaultSendMode: {
			type: "string",
			default: DEFAULT_SETTINGS.defaultSendMode,
			description: "Delivery mode used when sessions_send omits mode: queue or steer."
		},
		allowResume: {
			type: "boolean",
			default: DEFAULT_SETTINGS.allowResume,
			description: "Allow a send to wake a cold session. Off means sessions_read stays read-only and nothing is ever resumed."
		},
		frameMessages: {
			type: "boolean",
			default: DEFAULT_SETTINGS.frameMessages,
			description: "Prefix delivered messages with a frame naming the sending session, so the receiver can tell a peer from the human."
		},
		includeInjectedByDefault: {
			type: "boolean",
			default: DEFAULT_SETTINGS.includeInjectedByDefault,
			description: "Include harness-injected context (system reminders, memory snapshots) when reading another session."
		},
		maxListResults: {
			type: "number",
			default: DEFAULT_SETTINGS.maxListResults,
			description: "Upper bound on rows sessions_list returns."
		},
		maxReadMessages: {
			type: "number",
			default: DEFAULT_SETTINGS.maxReadMessages,
			description: "Upper bound on messages sessions_read returns."
		},
		maxMessageChars: {
			type: "number",
			default: DEFAULT_SETTINGS.maxMessageChars,
			description: "Per-message character budget before sessions_read truncates."
		},
		maxSendChars: {
			type: "number",
			default: DEFAULT_SETTINGS.maxSendChars,
			description: "Upper bound on the body length sessions_send delivers."
		}
	});
}
/**
* Cordis plugin entry point for the Host half.
*
* @param ctx - the plugin context, which owns every registration this makes.
* @param config - the composition row's own configuration, used as the base layer.
* @returns a disposer that unregisters everything, or nothing when registration
*   is owned by `ctx.effect`.
*/
async function apply(ctx, config = {}) {
	const services = resolveHostServices(ctx);
	let currentSource = () => resolveSettings(config);
	const toolContext = {
		query: services.query,
		controller: services.controller,
		agents: services.agents,
		settings: () => {
			const resolved = currentSource();
			return resolved.enabled ? resolved : {
				...resolved,
				enabled: false
			};
		}
	};
	const disposeTools = registerTools(ctx, services.tools, toolContext);
	const provider = ctx.get("settings");
	if (provider === void 0) {
		ctx.logger.info(`${PLUGIN_NAME}: no settings provider in this composition; using static configuration only`);
		return disposeTools;
	}
	let Schema;
	try {
		const module = await import("@deepseek-ai/schemastery");
		Schema = module.default;
	} catch (error) {
		ctx.logger.warn(`${PLUGIN_NAME}: @deepseek-ai/schemastery could not be resolved, so the ${SETTINGS_NAMESPACE} settings section is not declared and only static configuration applies. Install it in the profile to get the settings card: ${String(error)}`);
		return disposeTools;
	}
	provider.installSection(ctx, SETTINGS_NAMESPACE, buildSectionSchema(Schema), resolveSettings(config), {
		setSource: (source) => {
			currentSource = () => resolveSettings(source());
		},
		onChange: () => {
			ctx.logger.debug(`${PLUGIN_NAME}: ${SETTINGS_NAMESPACE} settings changed`);
		}
	});
	ctx.logger.info(`${PLUGIN_NAME}: registered sessions_list, sessions_read, sessions_send (namespace ${SETTINGS_NAMESPACE})`);
	return disposeTools;
}
/** Cordis plugin metadata consumed by the loader. */
const name = PLUGIN_NAME;
/** Hard dependencies: without these the tools cannot do their job at all. */
const inject = [
	"sessionQuery",
	"sessionController",
	"agents",
	"tools"
];

//#endregion
export { SETTINGS_NAMESPACE, apply, inject, name };