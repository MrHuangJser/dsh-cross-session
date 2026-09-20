import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build } from 'tsdown'

const root = fileURLToPath(new URL('..', import.meta.url))

// The host half is bundled so that the published tarball is self-contained: the
// Cordis plugin is loaded by the harness loader, which resolves it as a package
// rather than compiling TypeScript at boot.
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
  external: [],
})

// The client half is a browser bundle. React, Cordis, and the static UI libraries
// are seeded by the shell's frozen module table, so nothing is marked external
// here; see docs/architecture.md for the bundling contract.
await build({
  cwd: root,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  clean: false,
  sourcemap: false,
  external: [],
})

// Nothing else should reach the published output; a stray file here means a
// build input was added without updating this script.
await rm(new URL('../lib/.tsbuildinfo', import.meta.url), { force: true })
