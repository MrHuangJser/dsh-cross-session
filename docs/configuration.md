# Configuration

Everything configurable lives in one place: the settings namespace
**`cross-session`**. It is editable from the GUI card, from the settings document,
or from a composition row's `config`.

---

## Precedence

```text
settings document (user overrides)   ← GUI card and settings.yaml write here
        ▲ overrides
composition row config               ← cordis.patch.yml / preset row
        ▲ overrides
built-in defaults                    ← DEFAULT_SETTINGS in src/shared/settings.ts
```

The row's `config` is the **base** layer handed to `installSection`. The settings
document's section is the user layer. Once the section attaches, its resolved scope
replaces the base as the active source, so a GUI edit takes effect on the next tool
call with no reload.

---

## Settings

| Setting                    | Type               | Default | Range     | Effect                                                                                                                              |
| -------------------------- | ------------------ | ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                  | boolean            | `true`  | —         | When `false`, no tools are registered at all. The settings card still renders, so the switch that turned it off is still reachable. |
| `defaultSendMode`          | `queue` \| `steer` | `queue` | —         | Mode used when `sessions_send` omits `mode`.                                                                                        |
| `allowResume`              | boolean            | `true`  | —         | When `false`, a send to a **cold** session is refused before the target is resolved. Nothing is ever woken; reads remain available. |
| `frameMessages`            | boolean            | `true`  | —         | Prefix delivered bodies with the sender's identity frame.                                                                           |
| `includeInjectedByDefault` | boolean            | `false` | —         | Default for `sessions_read`'s `include_injected`.                                                                                   |
| `maxListResults`           | integer            | `25`    | 1–200     | Cap on rows `sessions_list` returns.                                                                                                |
| `maxReadMessages`          | integer            | `12`    | 1–100     | Cap on messages `sessions_read` returns.                                                                                            |
| `maxMessageChars`          | integer            | `1200`  | 100–20000 | Per-message budget before a read truncates.                                                                                         |
| `maxSendChars`             | integer            | `4000`  | 100–40000 | Cap on a delivered body.                                                                                                            |

### Choosing `allowResume`

This is the one setting with a real cost implication, so it is worth stating
plainly:

- `allowResume: true` (default) — a session can hand work to any peer, including
  one that is not currently loaded. Resolving a cold session loads it and the
  delivered message starts a turn, which spends that session's model budget.
- `allowResume: false` — sends are restricted to sessions that are already live.
  Reads still work everywhere, because reads never resume anything. This is the
  read-only-ish posture for a deployment that wants the discovery and inspection
  half without any ability to drive another session.

The refusal is issued **before** the target is resolved, so a deployment with
`allowResume: false` never partially wakes a session it then declines to use.

### Choosing `defaultSendMode`

- `queue` (default) — cooperative. The message becomes the target's next turn and
  never interrupts work in progress.
- `steer` — intrusive but timely. The message is inserted into the turn the target
  is running now, which is what you want when the target is mid-task on exactly the
  thing the message concerns.

Per-call `mode` on `sessions_send` overrides the default either way, so this only
decides the behaviour when the model does not choose.

---

## GUI card

**Settings → Plugins → Plugin configuration → dsh-cross-session.**

The card renders one row per setting, with the description text taken from the
schema declared in `src/index.ts`. Controls are a checkbox for booleans, a
`queue`/`steer` select for the mode, and a number input for the four limits.

The card is dispatched by the section that owns the `settings.plugin.item` slot,
keyed by the settings namespace. That key is the whole coupling: the section renders
the intersection of the namespaces the Host serves and the cards registered in the
browser, so:

- Host section without the browser card → **nothing renders**;
- browser card without the Host section → **the card is never dispatched**.

`SETTINGS_NAMESPACE` in `src/shared/meta.ts` is deliberately defined once, because
changing it in either half alone silently detaches the card.

---

## Raw settings-document shape

The GUI writes to `settings.yaml` under this namespace. The equivalent handwritten
section is:

```yaml
cross-session:
  enabled: true
  defaultSendMode: queue
  allowResume: true
  frameMessages: true
  includeInjectedByDefault: false
  maxListResults: 25
  maxReadMessages: 12
  maxMessageChars: 1200
  maxSendChars: 4000
```

Prefer the GUI card: it is fenced by the namespace revision, so a concurrent write
from another surface is refused rather than silently overwritten.

---

## Composition-row configuration

`cordis.patch.yml` ships with this row:

```yaml
- insert:
    - id: cross-session
      name: 'dsh-cross-session'
```

To set base values, add a `config` block:

```yaml
- insert:
    - id: cross-session
      name: 'dsh-cross-session'
      config:
        allowResume: false
        defaultSendMode: steer
        maxReadMessages: 20
```

Values set here are defaults, not locks — the settings document still overrides
them, and **Reset** on the GUI card returns a field to _this_ value rather than to
the built-in default. That is the behaviour of the settings provider, and it is the
useful one: the deployment's intent is the reset target.

---

## Validation and clamping

`resolveSettings(input: unknown)` accepts anything and never throws:

- wrong-typed values fall back to the built-in default;
- numbers are truncated toward zero and clamped into the documented range;
- `NaN` and infinities fall back to the default;
- an unrecognised `defaultSendMode` falls back to `queue`.

Clamping is applied on top of schema validation because a composition row's `config`
never travels through the settings document, and a plugin that refuses to load over
a mistyped number is worse than one that logs and continues with a bounded value.

Every rule above has a test in `test/settings.test.ts`.

---

## Turning it off

Three ways, in decreasing scope:

1. **`enabled: false`** in the card — the plugin stays mounted and the settings
   section stays editable, but no tools are registered. Use this to keep the
   capability one switch away.
2. **Remove the row** from the profile's `cordis.patch.yml` and restore the bundle
   stack. Cleanest if you want the tools gone from the catalog entirely.
3. **`dsh plugin --profile web remove dsh-cross-session`** — uninstalls the package,
   which removes the row via the same bundle reconciliation that added it.
