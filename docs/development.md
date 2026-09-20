# Development

---

## Toolchain

| Concern      | Choice                                                                                            | Why                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Language     | TypeScript, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`                  | the harness's own modelling style; catches the class of mistake that produces `undefined` at a tool boundary                                 |
| Lint         | ESLint flat config + `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, type-aware | the rules that matter in a plugin are type-aware ones (`no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`)            |
| Format       | Prettier, 2-space, no semicolons, single quotes, 100 columns                                      | formatting belongs to one tool; `eslint-config-prettier` is applied last so no stylistic rule can fight `prettier --check`                   |
| Tests        | `node --test`                                                                                     | Node 20+ strips TypeScript types natively, so the suite needs no transform pipeline and cannot drift from the runtime's own module semantics |
| Bundle       | `tsdown` (rolldown)                                                                               | emits the Host ESM bundle and the browser client bundle from one config                                                                      |
| Runtime deps | **none**                                                                                          | the plugin binds to harness services; see `docs/architecture.md` §8                                                                          |

```sh
pnpm install
pnpm run check        # format:check → lint → typecheck → test → build
```

Run a single file:

```sh
node --test test/sessions-send.test.ts
```

---

## Layout

```text
src/
  index.ts                  Host plugin entry: services → tools → settings section
  shared/
    meta.ts                 package identity + the one settings namespace constant
    settings.ts             CrossSessionSettings, defaults, bounds, resolveSettings
    events.ts               the two session-event shapes, text extraction, inject filter
  host/
    services.ts             typed service resolution + MissingServiceError
    sessions-list.ts        corpus listing, filtering, ranking, rendering
    sessions-read.ts        current-surface projection into a transcript
    sessions-send.ts        preflight, resume gating, framing, delivery
    tools.ts                the three ToolDefinitions and their argument narrowing
  client/
    index.ts                the settings card registered into settings.plugin.item
  types/
    platform.d.ts           hand-written declarations for the harness surface used
    react.d.ts              the two React members the card uses
test/                       one file per behavioural module
docs/                       this documentation
scripts/build.mjs           tsdown invocation for both bundles
cordis.patch.yml            the bundle patch that inserts the host row
```

The split is deliberate: `tools.ts` only narrows arguments and renders results.
Behaviour lives in `sessions-*.ts`, which take plain typed requests and are
therefore testable without a Cordis context, a registry, or a running harness.

---

## Testing strategy

The suite tests behaviour, not plumbing.

| File                         | What it pins                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `test/events.test.ts`        | Both event shapes; reasoning dropped; source labels; the injection prefix filter; `clip`                       |
| `test/settings.test.ts`      | Defaults, wrong-typed fallbacks, clamping, non-finite handling, mode normalization                             |
| `test/sessions-list.test.ts` | Self-last ordering, scope filtering, query matching, `liveOnly`, truncation reporting, rendering               |
| `test/sessions-read.test.ts` | Both message shapes through the reader, injection hidden/shown, system notices, windowing, replacement marking |
| `test/sessions-send.test.ts` | Framing, delivery, `resumed` reporting, every refusal code, and the ordering guarantees                        |

Two tests exist specifically because they caught real bugs during development:

- **`refuses a cold target before waking it when resume is disabled`** asserts that
  the controller was called **zero** times. The first implementation resolved the
  target first and checked `allowResume` afterwards, which woke a session it then
  declined to use.
- **`reports a resolve failure as a refusal`** pins that `resolveAgent`'s error
  branch is honoured. The first implementation discarded the result, so a session
  the controller refused to resolve still reported as delivered.

Fakes are hand-written and minimal (`fakeQuery`, `fakeController`) rather than
generated mocks: each test states exactly which two methods it depends on, so a
change to the real service surface shows up as a compile error in one place.

---

## Build

`pnpm run build` runs `scripts/build.mjs`, which invokes `tsdown` twice:

| Entry                 | Output                              | Platform | External                                    |
| --------------------- | ----------------------------------- | -------- | ------------------------------------------- |
| `src/index.ts`        | `lib/index.js` + `lib/index.d.ts`   | node     | `@deepseek-ai/schemastery` (dynamic import) |
| `src/client/index.ts` | `lib/client.js` + `lib/client.d.ts` | browser  | `react` and `react/jsx-runtime`             |

Both unresolved-import warnings during the build are **expected**:

- `@deepseek-ai/schemastery` resolves from the harness workspace at runtime, not
  from this package's `node_modules`.
- `react` is seeded by the shell's frozen module table, which the browser bundle
  resolves against.

If a future card needs a module **outside** that baseline, it must be declared in
`package.json`:

```json
"dsh": {
  "client": {
    "platform": "web",
    "external": ["@deepseek-ai/dsh-client-ui-something"]
  }
}
```

Composition rejects a malformed request, a missing supplier, a self-request, and a
synchronous request cycle, so a wrong entry fails loudly rather than at first render.

The Host bundle deliberately marks nothing external: it must run as a self-contained
package in the harness process.

---

## Adding a tool

1. Put the behaviour in a `host/sessions-*.ts` module. Take a plain typed request,
   return a typed result or a tagged refusal. Never throw for an expected refusal.
2. Add a `defineXTool(context)` function in `host/tools.ts`:
   - narrow `rawArgs` with the local `argsOf`/`stringArg`/`intArg` helpers;
   - clamp against the resolved settings, not against a literal;
   - render with `renderX` rather than assembling text inline.
     Add the definition to the array in `registerTools`.
3. Add the tool name to `TOOL_NAMES` in `shared/meta.ts`.
4. Add tests for: the happy path, every refusal, and any ordering guarantee the tool
   makes.
5. Document it in `docs/tools.md` with its exact schema and refusal codes.

Tool argument descriptions are model-facing prompt text. They are worth as much
care as the code: state what the tool does _not_ do (this package's descriptions say
"never with a reply" and "not its full transcript") because a model that
misunderstands a boundary will report a correct refusal as a failure.

---

## Conventions

- **Comments explain why.** A comment restating the code is noise; a comment naming
  the constraint that forced the code is the most valuable line in the file.
- **Deliberate rule relaxations carry a written reason.** `eslint.config.js` has one
  block per relaxation, each with a sentence explaining what would break without it.
- **Never silently swallow.** Every `catch` either degrades with a logged warning or
  returns a typed refusal. There is no empty `catch` in `src/`.
- **Boundaries are validated, not trusted.** Tool arguments, session events, and
  configuration all arrive as `unknown` and are narrowed explicitly.

---

## Releasing

`private: true` is set because the package is consumed by path. To publish:

1. remove `private`, set `publishConfig.access`;
2. confirm `files` covers `lib/`, `docs/`, `cordis.patch.yml`, `README.md`, `LICENSE`;
3. `pnpm run check && npm publish`;
4. verify the published tarball carries a **built** `lib/client.js` — the harness
   serves built client bundles and fails activation loudly when one is missing.
