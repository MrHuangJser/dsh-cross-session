# Troubleshooting

Every failure mode this package has, what it means, and what to do.

The first move for anything unexpected is to re-read the live contract rather than
trust a cached assumption. Ask your agent:

> Run a Cordis Inspect query: `Service.listService` with `{"service": "sessionController"}`.

That returns the running harness's exact signatures. This package's declared
surface lives in `src/types/platform.d.ts`; if the two disagree, the harness is
right.

---

## The plugin row will not load

### `dsh-cross-session requires the "<name>" Host service (<purpose>)`

`MissingServiceError`, thrown at mount. The harness composes 70+ services and a
minimal profile may omit one of the four this package needs:

| Service             | Used for                                 |
| ------------------- | ---------------------------------------- |
| `sessionQuery`      | reading other sessions                   |
| `sessionController` | delivering a message                     |
| `agents`            | resolving the calling session's identity |
| `tools`             | registering the tools                    |

**Fix.** Compose the plugin that provides the named service — for all four, that is
the base web/bootstrap bundle. The error names the service and why it was needed, so
it is unambiguous which row to add.

### The row loads but no tools appear

Check `enabled`:

```yaml
# settings.yaml
cross-session:
  enabled: false
```

With `enabled: false` the plugin mounts, logs `disabled by configuration; registered
no tools`, and registers nothing. Flip the switch on the GUI card, or remove the
override.

### `Cannot find package 'dsh-cross-session'`

The profile cannot resolve the package. Either it was never installed
(`dsh plugin --profile web add /absolute/path/to/dsh-cross-session`) or the profile's
`node_modules` was pruned. Re-run the install.

### Two rows, two tool registrations

A manual `cordis.patch.yml` mount line left in place **and** the bundle channel both
insert the row. Remove the manual line — the bundle patch owns it now. The same
mistake in other bundles is why `dsh-better-sidebar` ships a duplicate-mount guard;
this package does not, so a double mount registers `sessions_list` twice and the
loader rejects the second.

---

## The tools work but the settings card is missing

This is the expected failure when only one half loaded, and it is silent by design:
the Plugins section renders the **intersection** of the namespaces the Host serves
and the cards registered in the browser.

**Diagnose, in order:**

1. **Is the Host section served?** The plugin logs
   `registered sessions_list, sessions_read, sessions_send (namespace cross-session)`
   at mount. If instead you see
   `@deepseek-ai/schemastery could not be resolved`, the Host half is running on
   static configuration: `@deepseek-ai/schemastery` ships with the harness, so a
   missing copy means the profile's `node_modules` is incomplete.

2. **Is the browser bundle built, and in the right shape?** The harness serves
   **built** client bundles, and each one must self-register through
   `window.__ModuleLoader__.load` because the shell serves them inside a
   classic-script `/plugins` combo. A bundle that instead starts with an ESM
   `import` is a syntax error there and fails the whole plugin tree at boot —
   the error names whichever entry _preceded_ it in the combo (e.g.
   `dsh-client-hmr`), not this package. Check `lib/client.js` starts with
   `window.__ModuleLoader__.load({` and passes `node --check`; rebuild with
   `pnpm run build` if not.

3. **Did the bundle load in the browser?** Open the browser console. A client
   plugin that threw during `apply` logs its own warning and registers no card.

4. **Is the name the same on both sides?** The card's slot key must equal
   `SETTINGS_NAMESPACE` (`cross-session`). This is the single most likely cause of a
   missing card after a rename: the constant is defined once in
   `src/shared/meta.ts` precisely so both halves cannot drift, but a hand-edited
   literal in either half would detach them.

5. **Is the client being served at all?** Mounting a package whose `dsh.client` is
   malformed fails the whole plugin tree at boot (`duplicate prefix route`,
   `missing supplier`). Check the boot log.

**Fallback.** The card is a convenience, not the capability. The tools work without
it, and configuration can be set in the composition row's `config` or in
`settings.yaml` under the `cross-session` namespace — see `docs/configuration.md`.

---

## A read returns nothing useful

### `(no readable conversation in this session)`

The session has no `user/message`, `assistant/message`, or displayed
`system/message` events on its current surface. The usual causes:

- the session exists but was never prompted;
- every message in it is harness-injected and `include_injected` is off.

Retry with `include_injected: true` to confirm the second case.

### Messages come back empty

If text extraction were failing you would see a message row with no body. The two
event shapes are handled in `shared/events.ts` and pinned by tests, so this now
indicates a **new** event shape the harness introduced. Check what shape the event
actually has:

> Run a Cordis Inspect query: `Service.listService` with `{"service": "sessionQuery"}`,
> then read one event with `readEvent({ sessionId, seq })` and report the `data` keys.

A conversational event whose `data` has neither `content` nor `message` is a shape
`messageOf()` does not yet handle.

### Everything is truncated

Raise `maxMessageChars` (default 1200) and `maxReadMessages` (default 12), or read
the target session directly. Truncation is always marked (`…[truncated N chars]`,
`(N earlier messages omitted)`), so a summary is never mistaken for the whole.

### A stale turn is presented as current

It should not be: an event replaced by a later one is marked `replaced`. If you see
a superseded turn presented without that marker, the session's surface contains an
event whose `surfaceOp` this package mis-reads — report it with the event's `seq`.

---

## A send is refused

### `not-found`

No session with that id exists in the corpus. Ids are exact and case-sensitive.
Re-run `sessions_list` — note that a session id is not its title, and a title is not
an id.

### `not-messageable`

The target is a **subagent** session (it has a `parentSession` or
`origin: 'subagent'`). This is the harness's ownership fence, and it is intentional:
such a session belongs to the agent that spawned it, and a continuable child already
has a supported channel (`send_message` from its parent). There is no supported way
to message it from an unrelated session.

### `resume-disabled`

`cross-session.allowResume` is `false` and the target is not live. **The session was
not touched** — the check runs before the target is resolved. Either target a live
session or set `allowResume: true`.

### `rejected`

The controller refused admission, and the reason string carries its own message. The
common ones:

| Reason contains                    | Meaning                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/agent-busy`               | `prompt` rejected; the target's state refused the message. Retry, or use `queue`.                                                                                                                                           |
| `no adapter serves provider`       | The **target** has a pending model selection whose provider is not routable in this process. This is a property of the target session, not of the sender. Resolve it in that session (select a model) or on the host route. |
| `session/not-found`                | The target vanished between preflight and resolution.                                                                                                                                                                       |
| `disposed during prompt admission` | The target was closed mid-admission. Retry.                                                                                                                                                                                 |

### The message was delivered but nothing happened

Delivery is asynchronous, and `queue` does not wake a session that is idle. The
message is in the inbox and becomes the target's next turn when a turn starts. If
you need it to act now, use `mode: "steer"` — but note that `steer` inserts into a
_running_ turn; on an idle session `queue` is the correct verb.

Read the target with `sessions_read` to see whether it processed the message.

---

## The receiving session seems confused about who sent it

Check `frameMessages`. When it is `false`, the delivered body is bare and the
receiving model sees an ordinary user turn — it has no way to tell a peer session
from the human, and no id to reply to. With framing on, the body begins:

```text
Cross-session message from another session of this harness.
from-session: <sender id> ("<sender title>")
```

If framing is on and the receiver still cannot reply, the sender's own id may be
unresolvable (`unknown` in the frame): that happens when a call carries no
resolvable calling agent, which is a nested-dispatch edge case. Report it with the
tool call that produced it.

---

## Version drift

Verified against `@deepseek-ai/dsh@0.1.5-rc.2`. The harness is pre-1.0 and its
internal type declarations move between release candidates. Symptoms of drift, and
what each implies:

| Symptom                                               | Implies                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| A tool throws a `TypeError` on a method call          | A consumed service method was renamed or changed arity                   |
| `sessions_read` returns a header but no messages      | The surface snapshot's `events` field moved                              |
| The settings card renders no fields                   | `installSection`'s signature or the schema's `toJSON()` contract changed |
| The card does not render at all                       | The `settings.plugin.item` slot key or its dispatch rule changed         |
| Delivery reports `rejected` with an unfamiliar reason | `SessionPromptRequest` gained a required field                           |

For any of these, query the live contract first (`Service.listService`), then update
`src/types/platform.d.ts` to match, then re-run `pnpm run check`.

---

## Reporting a problem

Include:

1. the exact tool call (name + arguments);
2. the exact tool result text;
3. the harness version (`@deepseek-ai/dsh`) and this package's version;
4. the relevant lines from `node_modules/@deepseek-ai/dsh-*/lib/types/*.d.ts` for
   whichever service was involved.

Item 4 is what separates "the plugin is wrong" from "the runtime moved", and it is
the difference between a five-minute and an hour-long diagnosis.
