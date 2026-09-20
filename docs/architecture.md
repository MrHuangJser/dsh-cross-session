# Architecture

This document explains where `@mrhuangjser/dsh-cross-session` sits in the harness, what happens
between "the model calls `sessions_send`" and "another session starts thinking",
and why each structural decision was made the way it was.

---

## 1. Why this is a Host-plane plugin

The harness composes every capability as a plugin row in a `cordis.yml`. A row
belongs to one of two planes, and the choice is not about how "agent-related"
something feels — it is about whether the thing must be **shared**.

**Host plane.** The registries themselves, anything crossing sessions, the sandbox
and approval stack, the model route. One instance per process.

**Agent preset.** What one session contributes to those registries: its tools, its
persona, its prompt sections. One instance per session, unwound with it.

`@mrhuangjser/dsh-cross-session` is Host-plane, for three independent reasons:

1. **It reads the whole corpus.** `ctx.sessionQuery` is a process singleton that
   resolves live sessions and durable storage together. A per-session copy would
   see one session's view of a global store.
2. **It addresses sessions that are not its own.** `ctx.sessionController` owns
   resume policy for the entire process. There is exactly one.
3. **It registers a service-adjacent settings section.** A namespace registered
   twice collides, and the second session mounting the same preset would be the
   second registration.

A preset _could_ contribute the three tool rows while consuming the Host services,
and that is the normal pattern for model-facing tools. It is not what this package
does, because the requirement is that **every** session gets the capability. A
preset grants it only to sessions that select that preset.

---

## 2. The three services, and why each one

The harness contains four mechanisms that look like they might do this job. Only
one of them reaches an arbitrary existing session.

| Mechanism                                    | Reach                                                                                  | Verdict                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ctx.subagents.sendMessage`                  | adjacent Agents only — a direct continuable child, or a resident child's direct parent | cannot address a peer conversation                                                                      |
| `ctx.agentTeams`                             | documented contract for a lead + teammates                                             | **not implemented** in this deployment; the contract exists but no shipped package provides the service |
| `ctx.sessionReferenceResolver`               | snapshots a referenced session into the _current_ turn                                 | user-facing `@` mention; it never drives the other session                                              |
| `ctx.sessionController` + `ctx.sessionQuery` | any top-level session, by durable id                                                   | **this is the pair**                                                                                    |

### `ctx.sessionQuery` — the read path

The unified session query service. Reads prefer a live session over its persisted
copy and return detached clones from one consistent observation.

The read path is deliberately built on `readSurface()` rather than `listEvents()`:

- `readSurface()` returns the exact set of messages the target's own model
  currently sees — already free of superseded and log-only events.
- It costs **one** backend read. `listEvents()` plus `readEvent()` per message
  costs N+1.
- It carries `surfaceOp`, which is how a read can mark a message that a later
  event replaced instead of presenting a stale turn as current.

`listEvents()` is still used for one thing: counting the durable log so a read can
say how much it is not showing.

### `ctx.sessionController` — the send path

This is the service every browser prompt goes through, which is exactly why it is
the right seam: it already owns resume policy, preset policy, prompt admission,
queueing, steering, and the subagent ownership fence. Reimplementing any of that
would be a second, divergent implementation of a product contract.

`prompt({ requestId, sessionId, mode, content })`:

- **`mode: 'queue'`** → `agent.followup(message)`: the message becomes the target's
  next turn.
- **`mode: 'steer'`** → `agent.steer(message)`: the message is inserted into the
  turn the target is running now.
- The `requestId` is a correlation identity. A retry carrying an id the controller
  has already admitted is a no-op, which is a useful duplicate guard.
- The controller **attributes the message as a `user`-kind source**. That single
  fact is why this package frames its messages — see §4.

`resolveAgent(sessionId)` is called explicitly before `prompt`, even though
`prompt` can resolve on its own, for two reasons: the resume decision must be
observable (`resumed: true` in the result), and its refusal codes
(`session/not-found`, `session/agent-busy`, subagent ownership) are typed and
actionable, whereas a failure inside `prompt` is opaque.

---

## 3. The ownership fence, and why sends are top-level only

The session controller refuses to resolve a **subagent**-backed session for
ordinary prompt admission: a session with a `parentSession` or
`origin: 'subagent'` belongs to the agent that spawned it.

This package checks for that itself, _before_ calling the controller, so the model
gets a useful refusal instead of a `session/not-found`:

```text
NOT delivered to 019c3d96-… (not-messageable): "019c3d96-…" is a subagent session
owned by "session-bd715f08-…". A session may only message a top-level session;
subagent sessions are driven by the agent that owns them.
```

That is not a limitation to work around — it is the correct boundary. A continuable
subagent already has a supported channel (`send_message`, from its parent), and
routing around the fence would drive an agent whose owner believes it is idle.

---

## 4. Message framing

The controller records a delivered prompt as `{ kind: 'user' }`. There is no
"another session sent this" source kind, and inventing one would mean not using the
controller.

So the framing is in the body:

```text
Cross-session message from another session of this harness.
from-session: session-df31097d-375a-407c-afb5-8ce845aa5860 ("在dsh中实现跨会话通信")
delivery: queue
--- message begins ---
apply the same fix to the zai rows
--- message ends ---
```

Without it the receiving model cannot tell a peer session from the human operator,
and cannot address a reply. With it, a replier has everything needed to send back.

`frameMessages: false` turns this off for deployments that would rather the
message read as an ordinary turn.

---

## 5. Reading: two shapes through one API

The session log stores conversational events in **two different shapes**, and the
difference is invisible until output comes back empty:

```ts
// user/message — the event's `data` IS the message
{ type: 'user/message', data: { role: 'user', content: [...], source: {...} } }

// assistant/message — the event's `data` WRAPS the message
{ type: 'assistant/message', data: { turn, step, message: { role: 'assistant', content: [...] } } }
```

`messageOf()` in `src/shared/events.ts` handles both and is covered by tests,
because getting it wrong yields `''` rather than an exception. This was the single
most expensive mistake made while building the package.

Two further rules are applied on every read:

- **Text blocks only.** Reasoning blocks are dropped. They are model-internal,
  they dominate the byte cost of an assistant turn, and forwarding them would leak
  one session's scratchpad into another's context.
- **Harness injects are hidden by default.** System reminders and memory snapshots
  arrive as genuine `user/message` events with `source.kind: 'plugin'`, so they are
  indistinguishable by shape. They are detected by content prefix
  (`<system-reminder>`, `[MNEMON]`, `MNEMON RUNTIME MEMORY SNAPSHOT`,
  `Current runtime context.`) and filtered unless `include_injected` is set.

---

## 6. Lifecycle

```text
loader mounts the row
  │
  ├─ resolveHostServices(ctx)
  │    ctx.get('sessionQuery' | 'sessionController' | 'agents' | 'tools')
  │    → a missing one throws MissingServiceError naming it and its purpose
  │
  ├─ registerTools(ctx, tools, toolContext)
  │    → ctx.effect(...) registers all three; one disposer unregisters all three
  │
  ├─ ctx.get('settings')
  │    ├─ absent → static configuration only, log and done
  │    └─ present → import('@deepseek-ai/schemastery')
  │         ├─ fails → warn, keep static configuration, done
  │         └─ succeeds → installSection(ctx, 'cross-session', schema, base, hooks)
  │              setSource → the live configuration source replaces the base
  │
  └─ return the tool disposer
```

Everything is registered through `ctx.effect` or a service call that returns a
disposer, so stopping or unloading the plugin removes every side effect: the tools
disappear from the catalog and the settings section detaches.

**Failing loudly at mount.** `resolveHostServices` runs before anything is
registered. A deployment that composes the plugin without `sessionController`
fails at load with a message naming the missing service and what it was for —
rather than registering three tools that throw on first use.

**Degrading, not failing, for optional pieces.** The settings section is optional
twice over: no settings provider, or no `schemastery` to build the schema. Either
way the plugin keeps working with the composition row's own config and logs what is
missing. A tool that cannot act is indistinguishable from a broken install, so the
capability is never traded away for a missing configuration surface.

---

## 7. Configuration flow

```text
composition row config ──┐
                         ├─► resolveSettings(unknown) ──► CrossSessionSettings
settings document     ───┘        clamps, defaults, never throws
```

`resolveSettings` accepts `unknown` and cannot throw. Configuration is user input:
a plugin that refuses to load over a mistyped number is worse than one that logs and
continues with a bounded value. Numeric settings are clamped into a documented
range; wrong-typed values fall back to the default.

The active source is a thunk, not a snapshot:

```ts
let currentSource = () => resolveSettings(config)
// … later, when the settings document attaches:
currentSource = () => resolveSettings(source())
```

`installSection`'s `setSource` hook replaces that thunk, so a GUI edit changes tool
behaviour on the next call with no reload.

---

## 8. Why the SDK types are declared locally

`src/types/platform.d.ts` hand-declares the ~15 types and ~20 methods this package
uses, instead of importing `@deepseek-ai/dsh-*`.

1. **The published SDK trails the runtime.** npm carries `@deepseek-ai/dsh-agent`
   at `0.1.0-rc.6` and several others at `0.0.1-rc.1`; the running harness is
   `0.1.5-rc.2`, and the session and agent surfaces changed between those lines.
2. **Peer-importing the runtime would make the plugin brittle.** The loader
   resolves by package, so a declared peer dependency on a version string the
   runtime does not match can refuse to load.
3. **The binding is narrow and deliberate.** Only the methods actually called are
   declared, so an unrelated runtime change cannot break the build.

Every declaration was read from the running harness's own
`node_modules/@deepseek-ai/*/lib/types/*.d.ts` and cross-checked with live Cordis
Inspect queries. The trade-off is explicit: a real runtime divergence shows up as a
runtime failure rather than a compile error, which is why `docs/troubleshooting.md`
leads with the Inspect query to re-verify a signature.

**`@deepseek-ai/schemastery`** is resolved through a genuine dynamic
`import()` for the same reason, kept behind a `try`/`catch` so a deployment without
it still gets working tools.

---

## 9. The browser half

`src/client/index.ts` contributes one card to the `settings.plugin.item` slot,
keyed by the settings namespace.

The key is what couples the halves: the Plugins section renders the **intersection**
of the namespaces the Host serves and the cards registered in the browser. A served
namespace no card claims renders nothing; a card whose namespace the Host does not
serve is never dispatched. Registering the card under `cross-session` is therefore
what makes the Host section visible at all — neither half alone shows anything.

The card is written against `react`'s `createElement` rather than JSX, and the
bundle is built as a browser ESM bundle. The shell seeds a frozen module table
(React, Cordis, the static UI libraries) that dynamic bundles resolve against; the
package declares `dsh.client.external: []` because nothing it imports falls outside
that baseline. See `docs/development.md` for how to change that if a future card
needs a non-baseline module.
