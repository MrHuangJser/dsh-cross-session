# Comparison: Codex's cross-session capability

This document records what the analogous feature in OpenAI's Codex CLI actually is,
mechanism by mechanism, and where `@mrhuangjser/dsh-cross-session` deliberately matches it and
where it differs. It exists because "implement the same thing as Codex" is not a
specification until the thing is pinned down.

Findings below come from the `openai/codex` source tree at commit
`5c5308f` (`main`), its release notes, and its published documentation. Sources are
listed at the end.

---

## What the feature is

Codex's official name for it is **multi-conversation "agent control"**. The
`v0.79.0` release notes (2026-01-07) describe it as:

> Add multi-conversation "agent control" so a session can spawn or message other
> conversations programmatically

It surfaces to the model as the **subagents / multi-agent / collab tools**. A
subagent owns an independent `ThreadId` (UUIDv7, identical to its `RolloutId`) and
therefore its own rollout file — so agent-to-agent communication _is_
session-to-session communication.

Two generations of tools exist:

|                                                                                           | Tools                                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **V1** (`multi_agent_v1`)                                                                 | `spawn_agent`, `send_input`, `wait_agent`, `resume_agent`, `close_agent`                       |
| **V2** (namespace from `features.multi_agent_v2.tool_namespace`, default `collaboration`) | `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, `list_agents` |

---

## Mechanism by mechanism

### Identity

- V1 uses `agent_id`, described in the schema as _"Thread identifier for the spawned
  agent"_ — i.e. the `ThreadId`.
- V2 replaced this with **path-style task names** (`/root`, `/root/task1/task_3`;
  lowercase letters, digits, underscores). A relative reference resolves against the
  current path.

`@mrhuangjser/dsh-cross-session` uses the harness's own durable session id, which is what
`sessions_list` returns. It is not path-shaped because the harness has no agent
tree to encode: a session id addresses a session anywhere in the corpus.

### Discovery

`list_agents` — _"List live agents in the current root thread tree"_, filterable by
`path_prefix`. It returns `{agent_name, agent_status}` and **no content**. The durable
topology lives in a separate `agent-graph-store` crate
(`upsert_thread_spawn_edge`, `list_thread_spawn_children`,
`list_thread_spawn_descendants`; edges are `open` or `closed`).

`sessions_list` returns strictly more per row — durable id, folded title, workspace
path, agent preset, live/cold, top-level/subagent — across the whole corpus rather
than one tree.

### Reading another conversation

This is the finding that most changes what "implement the same feature" means.

**Codex does not let a model read another thread's history.** A parent receives:

- its subagent's **final message** when the child terminates
  (`Message Type: FINAL_ANSWER / Task name / Sender / Payload`); V2 `wait_agent`
  states outright _"Does not return the content"_;
- messages the child explicitly sends it (`MESSAGE` / `NEW_TASK` envelopes).

`fork_context` / `fork_turns` run the other way: they copy the _parent's_ history
into a child. No tool returns a peer's transcript.

`sessions_read` therefore goes further than Codex here, and does so inside the
harness's own boundaries: it returns a **bounded window of the target's current
model surface** — the messages that session's model actually sees, with tool output
and reasoning excluded, harness-injected context hidden by default, and truncation
marked.

### Sending

Unified through `LocalAgentControl::deliver_message()` with two delivery modes:

- `MessageDeliveryMode::QueueOnly` — enqueue, do not wake.
- `MessageDeliveryMode::TriggerTurn` — start a turn if the target is idle; **may not
  target the root**.

`send_message` (V2) is the QueueOnly verb — _"Does not trigger a new turn"_.
`followup_task` (V2) is the TriggerTurn verb. V1 `send_input` returns
`{submission_id}` with an `interrupt` flag for preemption.

This maps closely onto the harness:

| Codex                                     | @mrhuangjser/dsh-cross-session                                |
| ----------------------------------------- | ------------------------------------------------------------- |
| `send_message` (QueueOnly)                | `sessions_send` with `mode: "queue"`                          |
| `followup_task` (TriggerTurn)             | `sessions_send` with `mode: "steer"` on a live target         |
| `resume_agent` / auto-reload from rollout | `resolveAgent` resumes a cold session, gated by `allowResume` |

One difference in the envelope: Codex gives inter-agent messages their own context
envelope (`inter_agent_message.rs`), so the receiver's model sees a
machine-attributed message. The harness's session controller files a delivered
prompt as a `user`-kind source, so this package composes the attribution into the
body instead — see `docs/architecture.md` §4 for why that is the honest choice
rather than a workaround.

Codex's mailbox is an **in-memory queue** (`enqueue_mailbox_communication`). There
is no file-based mailbox and no `.codex/` message directory; `.codex/agents/` holds
custom agent _definitions_ (TOML), unrelated to messaging.

### Reach — the substantive difference

Codex's collab tools resolve names **inside the calling agent's own root thread
tree**: `resolve_agent_reference` fails with
`live agent path ... not found` for anything outside it, and `TriggerTurn` delivery
explicitly refuses the root. There is no model-facing tool that reads or writes an
arbitrary pre-existing user conversation.

`sessions_read` and `sessions_send` address **any top-level session in the corpus by
durable id**. That is a strict superset of Codex's reach.

The harness imposes one matching restriction, and this package enforces it: a
**subagent** session (one with a `parentSession` or `origin: 'subagent'`) is not
addressable, because it belongs to the agent that spawned it. That is the same
boundary Codex draws with tree scoping, expressed as an ownership fence instead of a
namespace.

### Permissions

Codex subagents inherit the parent turn's sandbox and approval runtime overrides;
an action needing approval in a non-interactive child fails and reports back.
This package introduces no permission surface of its own: a delivered message lands
in the target session's inbox, and everything the target then does runs under _that
session's_ sandbox policy, approval policy, and model route — not the sender's.
That is the important safety property, and it falls out of using
`ctx.sessionController` rather than reimplementing delivery.

### Version and flags

Landed `v0.79.0` (2026-01-07, PRs #8783/#8788). `v0.81.0` added `wait_agent` and
`close_agent`; `v0.85.0` added agent roles and `send_input` interruption (#9275);
`v0.105.0` (2026-02-25) listed it as a headline feature; path-style naming arrived
2026-03-20 (#15313) and the mailbox-for-wait change 2026-03-30 (#16010).

Flags: `features.multi_agent` (`Feature::Collab`, `Stage::Stable`, **on by
default**; legacy alias `features.collab`); `features.multi_agent_v2`
(`Stage::Stable`, **off by default**; a model catalog entry may override it via
`multi_agent_version` metadata); `agents.enabled` defaults to `true`. The older
`multi_agent_mode` key is `Removed`. Defaults: V2 allows 4 concurrent threads per
session; wait timeout is 10s minimum, 1h maximum, 30s default; V1 `max_threads`
default 6, `max_depth` default 1.

`sessions_send` has no concurrency quota. Delivery is bounded by the target's own
inbox semantics, and the volume limits this package does impose are read-side
(`maxListResults`, `maxReadMessages`, `maxMessageChars`, `maxSendChars`).

---

## Distinguishing it from Codex's other multi-session facilities

These are **client-layer** operations on existing sessions, not model tools, and
they are not what this package reimplements:

- `codex resume`, `codex exec resume` — reopen a prior conversation for the human.
- app-server `thread/list` / `thread/read` / `thread/resume` — client APIs.

The harness has a direct analogue of the second group: the browser's session list,
plus `sessionReferenceResolver`, which lets a _user_ pull another session's snapshot
into the current turn with an `@` mention. That is user-initiated context injection;
`@mrhuangjser/dsh-cross-session` is model-initiated peer communication. They are complements, not
overlaps.

---

## Summary

| Capability                        | Codex                                          | @mrhuangjser/dsh-cross-session                                                  |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Create a peer conversation        | `spawn_agent`                                  | not offered — the harness already has `subagent`                                |
| Discover peers                    | `list_agents`, live only, name + status        | `sessions_list`, full corpus, richer rows                                       |
| Read a peer's final message       | yes (completion notification, `wait_agent` V1) | yes, via `sessions_read`                                                        |
| Read a peer's conversation window | **no tool exists**                             | yes — bounded, filtered, truncation-marked                                      |
| Message a peer without waking it  | `send_message` (QueueOnly)                     | `sessions_send` `mode: "queue"`                                                 |
| Message a peer and wake it        | `followup_task` (TriggerTurn)                  | `sessions_send` `mode: "steer"`, or `queue` to a cold target with `allowResume` |
| Interrupt a peer's turn           | `interrupt_agent`                              | not offered — `interrupt_agent` in the harness covers continuable children      |
| Reach                             | the caller's own thread tree                   | any top-level session                                                           |
| Blocking?                         | no, mailbox + `wait_agent`                     | no, returns on inbox acceptance                                                 |

The harness's `subagent` / `subagent_fork` / `send_message` / `list_agents` row set
already covers the Codex core (spawn a child, message it, collect its result). What
was missing — and what this package adds — is addressing sessions that **already
exist** and are not yours.

---

## Sources

Source tree (`5c5308f`):

- [`multi_agents_spec.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/tools/handlers/multi_agents_spec.rs) — the V1/V2 tool schemas
- [`multi_agents.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/tools/handlers/multi_agents.rs) — handlers
- [`control/delivery.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/agent/control/delivery.rs) — `MessageDeliveryMode`, `deliver_message`
- [`control/spawn.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/agent/control/spawn.rs) — spawn and resume
- [`agent_resolver.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/agent/agent_resolver.rs) — reference scoping
- [`agent_path.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/protocol/src/agent_path.rs) — path-style names
- [`thread_id.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/protocol/src/thread_id.rs) — `ThreadId`
- [`agent-graph-store/store.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/agent-graph-store/src/store.rs) — durable topology
- [`context/inter_agent_message.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/context/inter_agent_message.rs) and [`inter_agent_completion_message.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/core/src/context/inter_agent_completion_message.rs) — message envelopes
- [`features/src/lib.rs`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/features/src/lib.rs) — feature flags

Releases and PRs:

- [v0.79.0](https://github.com/openai/codex/releases/tag/rust-v0.79.0) · [v0.81.0](https://github.com/openai/codex/releases/tag/rust-v0.81.0) · [v0.85.0](https://github.com/openai/codex/releases/tag/rust-v0.85.0) · [v0.105.0](https://github.com/openai/codex/releases/tag/rust-v0.105.0)
- [#8783](https://github.com/openai/codex/pull/8783) · [#8788](https://github.com/openai/codex/pull/8788) · [#9275](https://github.com/openai/codex/pull/9275) · [#15313](https://github.com/openai/codex/pull/15313) · [#16010](https://github.com/openai/codex/pull/16010)

Documentation:

- [Subagents — learn.chatgpt.com](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)
- [Subagents — developers.openai.com](https://developers.openai.com/codex/subagents)

### Unverified

Stated for honesty rather than completeness:

- Whether a managed OpenAI-hosted build enables `multi_agent_v2` by default is
  unknown (the repository default is off; a model catalog entry may override it).
- Whether V1's `wait_agent` truncates the final message it returns could not be
  confirmed; V2's error branch does truncate, its `completed` branch shows no
  equivalent handling.
- `spawn_agents_on_csv` / `report_agent_job_result` (a CSV batch facility mentioned
  for `v0.105.0`) are absent from current `main`; the version that removed them was
  not identified.
