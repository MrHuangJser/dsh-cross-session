import { readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build } from 'tsdown'

const root = fileURLToPath(new URL('..', import.meta.url))
const PACKAGE_NAME = '@mrhuangjser/dsh-cross-session'

// ── Host bundle ─────────────────────────────────────────────────────────────
// The Host half is loaded by the harness loader as a plain Node ESM module.
// It must be self-contained: nothing is external except the runtime-owned
// `@deepseek-ai/schemastery`, which `src/index.ts` resolves lazily at apply
// time through `createRequire` so a deployment without it still loads.
await build({
  cwd: root,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  dts: true,
  clean: false,
  sourcemap: false,
  external: ['@deepseek-ai/schemastery', 'node:module', 'node:path', 'node:fs', 'node:url'],
})

// ── Client bundle ───────────────────────────────────────────────────────────
// The browser half is loaded by the shell's `__ModuleLoader__`, which expects a
// CLASSIC-script bundle of this exact shape:
//
//   window.__ModuleLoader__.load({
//     id: "<package name>",
//     factory: (require) => {
//       var module = { exports: {} };
//       var exports = module.exports;
//       <CJS body — externals via require("...")>
//       return module.exports;
//     },
//   });
//
// `require` resolves against the shell's frozen module table (React, Cordis,
// the static UI libraries) plus any package named in `dsh.client.external`, so
// those specifiers must stay `require()` calls — they are NOT bundled in. An
// ESM bundle here is a syntax error inside the classic-script combo and takes
// the whole plugin tree down with it; this is the exact failure this wrapper
// prevents.
await build({
  cwd: root,
  entry: { 'client-inner': 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: false,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})

// Wrap the emitted CJS body in the module-loader envelope the shell expects.
const cjs = await readFile(new URL('../lib/client-inner.cjs', import.meta.url), 'utf8')
const wrapped =
  `window.__ModuleLoader__.load({\n` +
  `\tid: ${JSON.stringify(PACKAGE_NAME)},\n` +
  `\tfactory: (require) => {\n` +
  `\t\tvar module = { exports: {} };\n` +
  `\t\tvar exports = module.exports;\n` +
  `\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n` +
  cjs
    .split('\n')
    .map((line) => (line.length === 0 ? line : `\t\t${line}`))
    .join('\n') +
  `\n\t\treturn module.exports;\n` +
  `\t}\n` +
  `});\n`

await writeFile(new URL('../lib/client.js', import.meta.url), wrapped)
await rm(new URL('../lib/client-inner.cjs', import.meta.url), { force: true })

// Emit type declarations for the client entry separately: tsdown skips dts for
// CJS-only builds, and package consumers (and `tsc`) still want them. The dts
// pass is routed to a temp dir and only its .d.ts is kept — an emit to `lib`
// would overwrite the wrapped bundle this script just wrote.
await build({
  cwd: root,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib/.dts-tmp',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: { only: true },
  clean: false,
  sourcemap: false,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})

const { rename } = await import('node:fs/promises')
await rename(
  new URL('../lib/.dts-tmp/client.d.ts', import.meta.url),
  new URL('../lib/client.d.ts', import.meta.url),
)
await rm(new URL('../lib/.dts-tmp', import.meta.url), { recursive: true, force: true })
