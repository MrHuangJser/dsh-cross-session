# Tools

Three tools, all registered by the Host half. Names are stable: sessions and
transcripts may cite them.

Every tool returns plain text. Argument validation never throws — a bad call
produces a readable refusal the model can correct from, because a stack trace
teaches a model nothing.

---

## `sessions_list`

Discover peer sessions.

| Argument    | Type                                | Required | Meaning                                                                                                            |
| ----------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `query`     | string                              | no       | Case-insensitive filter over durable id, folded title, workspace path, and preset id. Empty lists the most recent. |
| `scope`     | `top-level` \| `subagents` \| `all` | no       | Defaults to `top-level`.                                                                                           |
| `live_only` | boolean                             | no       | Only sessions live right now. Defaults to `false`.                                                                 |
| `limit`     | integer 1–200                       | no       | Rows to return, further capped by `maxListResults`.                                                                |

**Output** — one block per row, plus a footer with counts:

```text
- session-e218a09e-8736-4483-9a04-2bf13608630c [cold, top-level] | cwd=/Users/huangjiangheng/.dsh | preset=standard
    Fix the newapi reasoning-effort config
- 019c3d96-79e0-4e6a-b7bf-ea46c224d701 [cold, subagent] | cwd=/Users/huangjiangheng/Soul/new-memory-system | preset=standard | not messageable
    Bounded completed checkpoint

2 of 60 considered sessions
Top-level sessions are messageable with sessions_send; subagent sessions are not.
```

Ordering: newest first by creation time, except that **the calling session is always
last**, so a model reading the list sees actionable peers before itself.

Titles are folded in one batch (`readTitleSnapshots`). A title is a log-derived
value rather than a header field, so asking per session would turn one listing into
N log reads.

**Search note.** `query` filters the already-listed corpus locally. A deployment
whose session-query index is disabled (`openAt: "never"`) simply has no ranked
full-text search; the local filter still works over id, title, workspace, and
preset. That is why this tool never depends on `searchSessions()`.

---

## `sessions_read`

Read a bounded, text-only window of another session's current conversation.

| Argument           | Type          | Required | Meaning                                                                             |
| ------------------ | ------------- | -------- | ----------------------------------------------------------------------------------- |
| `session_id`       | string        | **yes**  | Durable session id, as returned by `sessions_list`.                                 |
| `max_messages`     | integer 1–100 | no       | Messages to return, further capped by `maxReadMessages`.                            |
| `include_injected` | boolean       | no       | Include harness-injected context. Defaults to `includeInjectedByDefault` (`false`). |
| `include_system`   | boolean       | no       | Include plugin-authored system notices. Defaults to `false`.                        |

**Output**:

```text
session session-e218a09e-8736-4483-9a04-2bf13608630c [live, top-level] | cwd=/Users/huangjiangheng/.dsh
title: Fix the newapi reasoning-effort config
readable messages: 69 | captured through seq: 413
--- user (seq 407, user) ---
the reasoning selector is empty for every model
--- assistant (seq 396, model:opencode-go-deepseek/deepseek-flash) ---
fixed. root cause: reasoningEfforts was never declared per model entry…
(2 earlier messages omitted)
```

Each row carries provenance: the `source` label (`user`, `model:provider/model`,
`plugin:name/form`), and the markers `harness-injected` and `replaced` when they
apply.

**What it returns.** The target's _current model surface_ — the exact messages that
session's own model sees now. Not its full log, not its tool output, never its
reasoning blocks.

**What it filters.** Harness-injected content is hidden unless `include_injected` is
set. Detection is by content prefix, because system reminders and memory snapshots
are recorded as genuine `user/message` events:
`<system-reminder>`, `[MNEMON]`, `MNEMON RUNTIME MEMORY SNAPSHOT`,
`Current runtime context.`.

**Truncation is visible.** A message longer than `maxMessageChars` ends with
`…[truncated N chars]`, and a windowed read ends with
`(N earlier messages omitted)`. Nothing is cut silently.

**This is a read, never a wake.** `sessions_read` uses only `sessionQuery`, so
reading a cold session never resumes it, never allocates a turn, and never spends
tokens on that session's model.

---

## `sessions_send`

Deliver a message into another top-level session's inbox.

| Argument     | Type               | Required | Meaning                                    |
| ------------ | ------------------ | -------- | ------------------------------------------ |
| `session_id` | string             | **yes**  | Durable id of the target.                  |
| `message`    | string             | **yes**  | Body to deliver, capped by `maxSendChars`. |
| `mode`       | `queue` \| `steer` | no       | Defaults to `defaultSendMode` (`queue`).   |

**`queue`** becomes the target's next turn. It does not interrupt anything the
target is doing; the message waits in its inbox.

**`steer`** is inserted into the turn the target is running now, so it can change
what that session does mid-flight. Use it when the target is working on the thing
the message is about.

**Output (accepted)**:

```text
accepted for session-4b91… | mode=queue | chars=214 (woke a cold session)
The message is queued in that session's inbox. Its reply will not return through
this call; read it later with sessions_read.
```

**Delivery is asynchronous.** The call resolves when the inbox accepts the message,
never when the target finishes thinking. A reply is another explicitly addressed
message that you read with `sessions_read` afterwards.

**Framing.** Unless `frameMessages` is off, the delivered body is prefixed with:

```text
Cross-session message from another session of this harness.
from-session: <sender id> ("<sender title>")
delivery: queue
--- message begins ---
<body>
--- message ends ---
```

The frame exists because the controller files the message as a `user`-kind source:
without it, the receiving model cannot tell a peer from the human, and cannot reply
by id.

### Refusal codes

Refusals are returned as text in the tool result — never as a thrown error — so the
model always learns _why_ and what to try next.

| `code`            | Cause                                                                 | What the model should do                                                                      |
| ----------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `not-found`       | No session with that id in the corpus                                 | Re-run `sessions_list` for a valid id                                                         |
| `not-messageable` | Target is a subagent session (has a parent or `origin: subagent`)     | It is owned by another agent; there is no supported way to message it from here               |
| `resume-disabled` | Target is cold and `allowResume` is `false`                           | The session was left untouched; either target a live session or ask the user to enable waking |
| `empty-body`      | Body is empty after trimming                                          | Nothing was delivered; supply a body                                                          |
| `rejected`        | The controller refused admission, or the target could not be resolved | The reason string carries the controller's own message                                        |

Two ordering guarantees matter here:

1. **`resume-disabled` is checked before resolving the target.** Declining to wake
   a session leaves it genuinely untouched, rather than resumed and then abandoned.
2. **`not-messageable` is checked before anything else touches the target.** The
   refusal names the owning session.

---

## Tool catalog cost

The three schemas are fixed and registered once, so they are part of the
prefix-stable portion of every request on a deployment that mounts this plugin. The
total is roughly 1.2 kB of tool schema.

If that cost matters more than the capability in some deployment, set
`enabled: false`: the plugin then registers no tools at all. An alternative is to
mount this plugin row in a preset instead of the host composition, which grants the
tools to sessions on that preset only — see `docs/architecture.md` §1 for why this
package ships host-plane by default.
