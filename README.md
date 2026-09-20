# @huangjiangheng/dsh-cross-session

**Let one DeepSeek Harness session list, read, and message another session.**

One conversation can now discover its peers, read a bounded window of what a peer
is actually discussing, and hand work to it — without the user relaying messages by
hand and without spawning a subagent.

```text
you ▸ what is the other session doing?
bot ▸ sessions_list({})                       → 3 sessions, ids + titles + live state
bot ▸ sessions_read({ session_id: "session-e218…" })
    → title: Fix the newapi reasoning-effort config
      --- user (seq 407, user) ---
      the reasoning selector is empty for every model
      --- assistant (seq 396, model:opencode-go-deepseek/deepseek-flash) ---
      fixed. root cause: reasoningEfforts was never declared per model entry…
bot ▸ sessions_send({ session_id: "session-4b91…", message: "apply the same fix to the zai rows" })
    → accepted for session-4b91… | mode=queue | chars=214
      The message is queued in that session's inbox.
```

---

## What this is

The DeepSeek Harness already contains every primitive this needs. What it did not
have is a model-facing surface for them: a session could only talk to the
subagents it had spawned itself.

This package adds that surface — three tools, one settings card.

| Tool            | What it does                                                                | Backed by                      |
| --------------- | --------------------------------------------------------------------------- | ------------------------------ |
| `sessions_list` | Discover peer sessions: id, title, workspace, live/cold, top-level/subagent | `ctx.sessionQuery`             |
| `sessions_read` | Read a bounded, text-only window of a peer's current conversation           | `ctx.sessionQuery.readSurface` |
| `sessions_send` | Deliver a message into a peer's inbox, `queue` or `steer`                   | `ctx.sessionController`        |

Two properties are worth stating plainly, because they define the shape of the
feature:

- **Reading is not transcript injection.** `sessions_read` returns the peer's most
  recent user and assistant text, capped by count and by characters. It never
  returns tool output, never returns model reasoning, and hides harness-injected
  context (system reminders, memory snapshots) unless asked.
- **Sending is asynchronous.** `sessions_send` returns when the target's inbox
  accepts the message, never when the target finishes thinking. A reply is another
  explicitly addressed message that you read later with `sessions_read`.

---

## How this relates to Codex

Codex ships the same idea under the name **multi-conversation "agent control"**
(landed in `v0.79.0`, 2026-01-07, release note: _"a session can spawn or message
other conversations programmatically"_), exposed as the subagent/collab tools —
`spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`,
`list_agents`.

The mechanisms agree on the parts that matter, and this package deliberately
mirrors them:

| Behaviour          | Codex                                                                               | @huangjiangheng/dsh-cross-session                               |
| ------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Peer identity      | `ThreadId`, later path-style `/root/task1/task_3`                                   | durable session id (`session-…` / UUID)                         |
| Discovery          | `list_agents`, live agents only, name + status                                      | `sessions_list`, full corpus, id + title + workspace + liveness |
| Read               | **final message only**; no tool returns a peer's history                            | bounded window of the peer's current conversation               |
| Send               | asynchronous mailbox; `send_message` does not trigger a turn, `followup_task` wakes | `queue` (= queue) and `steer` (= insert into the running turn)  |
| Waking a cold peer | `resume_agent` / auto-reload from rollout                                           | `resolveAgent` resumes, gated by `allowResume`                  |
| Reach              | **same agent tree only**                                                            | any top-level session in the corpus                             |

The one substantive difference is reach. Codex's collab tools resolve names inside
the calling agent's own thread tree, so they cannot address an unrelated
conversation; `followup_task` explicitly refuses the root. This package addresses
any top-level session by durable id, which is a strict superset — and it inherits
one matching restriction from the harness: a **subagent** session is not
addressable this way, because those belong to the agent that spawned them.

Full write-up with sources: [`docs/comparison-codex.md`](docs/comparison-codex.md).

---

## Install

The package is a Host-plane plugin: it must load in the harness process, next to
`sessionQuery` and `sessionController`, so that every session gets the tools.

```sh
# the published package, by name — for anyone, anywhere
dsh plugin --profile web add @huangjiangheng/dsh-cross-session

# a GitHub tarball works too, no npm needed
dsh plugin --profile web add github:MrHuangJser/dsh-cross-session

# a local clone, for development
pnpm install && pnpm run check
dsh plugin --profile web add /absolute/path/to/dsh-cross-session
```

The CLI installs the package through `pnpm add`, then reconciles
`dsh.profile.bundles` for you — the `dsh.bundle.patch` declaration ships in the
package, so no manual `cordis.patch.yml` line is needed.

Restart the profile, then confirm the tools are visible:

```sh
dsh plugin --profile web list
```

Open **Settings → Plugins → Plugin configuration** and you should see a
**@huangjiangheng/dsh-cross-session** card. If the card is missing but the tools work, the
browser half did not load — see [Troubleshooting](docs/troubleshooting.md).

### Manual mount instead of the CLI

If you would rather not let the CLI touch `dsh.profile.bundles`, add the package
to the profile's dependencies and insert the row yourself in the profile's
`cordis.patch.yml`:

```yaml
- insert:
    - id: cross-session
      name: '@huangjiangheng/dsh-cross-session'
```

---

## Configuration

Every setting lives in the settings namespace `cross-session` and is editable from
the GUI card. The composition row's `config` is the base layer; the settings
document overrides it field by field.

| Setting                    | Default | What it controls                                              |
| -------------------------- | ------- | ------------------------------------------------------------- |
| `enabled`                  | `true`  | Register the tools at all                                     |
| `defaultSendMode`          | `queue` | Mode used when `sessions_send` omits `mode`                   |
| `allowResume`              | `true`  | Whether a send may wake a **cold** session                    |
| `frameMessages`            | `true`  | Prefix delivered messages with the sending session's identity |
| `includeInjectedByDefault` | `false` | Include harness-injected context in reads                     |
| `maxListResults`           | `25`    | Cap on rows `sessions_list` returns (1–200)                   |
| `maxReadMessages`          | `12`    | Cap on messages `sessions_read` returns (1–100)               |
| `maxMessageChars`          | `1200`  | Per-message budget before a read truncates (100–20000)        |
| `maxSendChars`             | `4000`  | Cap on a delivered body (100–40000)                           |

`allowResume: false` is the read-only deployment: `sessions_send` refuses a cold
target **before** resolving it, so nothing is ever woken. Details and the raw
settings-document shape: [`docs/configuration.md`](docs/configuration.md).

---

## Documentation

| Document                                               | Contents                                                 |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)         | Planes, lifecycle, data flow, why each decision was made |
| [`docs/tools.md`](docs/tools.md)                       | Exact tool schemas, argument semantics, refusal codes    |
| [`docs/configuration.md`](docs/configuration.md)       | Every setting, its bounds, and how it reaches the GUI    |
| [`docs/comparison-codex.md`](docs/comparison-codex.md) | The Codex feature, mechanism by mechanism, with sources  |
| [`docs/development.md`](docs/development.md)           | Toolchain, scripts, testing strategy, how to add a tool  |
| [`docs/troubleshooting.md`](docs/troubleshooting.md)   | Failure modes and what each one means                    |

---

## Development

```sh
pnpm run build         # tsdown → lib/index.js (host) + lib/client.js (browser)
pnpm run typecheck     # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
pnpm run lint          # eslint, typescript-eslint strictTypeChecked
pnpm run format        # prettier, 2-space
pnpm run test          # node --test (Node's own runner, native TypeScript stripping)
pnpm run check         # all of the above, in CI order
```

Requires Node ≥ 20.11. No runtime dependencies: the plugin binds to the harness's
own services and declares its SDK surface locally
([`src/types/platform.d.ts`](src/types/platform.d.ts)).

---

## Compatibility

Verified against the harness runtime that ships as `@deepseek-ai/dsh@0.1.5-rc.2`.
The Host services this package consumes are stable product contracts, but the
harness is pre-1.0: check `docs/troubleshooting.md` before assuming a failure is
this package's fault, and check the service list with a Cordis Inspect query
(`Service.listService`) when a signature looks different.

## License

MIT — see [LICENSE](LICENSE).
