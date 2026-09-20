import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * Strict, type-aware ESLint configuration.
 *
 * Design rules for this file:
 * 1. Formatting belongs to Prettier. `eslint-config-prettier` is applied last so
 *    no stylistic rule can ever fight `prettier --check` in CI.
 * 2. Type-aware linting (`projectService`) is on by default: the rules that catch
 *    real async and nullability bugs in a Cordis plugin are type-aware ones.
 * 3. Every deliberate relaxation carries a written reason. A rule is never
 *    disabled globally when a narrow inline disable with a reason will do.
 */
export default tseslint.config(
  {
    // Never lint build output, dependencies, or generated declarations.
    ignores: ['lib/**', 'dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Resolve types through the project service so `tsc --noEmit` and ESLint
        // agree on exactly which files belong to the program.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Async correctness ─────────────────────────────────────────────────
      // A Cordis plugin is a graph of async lifecycles; a dropped promise is a
      // silently dead tool, so every floating promise must be explained.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksVoidReturn: true, checksSpreads: true },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],

      // ── Boundary safety ───────────────────────────────────────────────────
      // Session events, tool arguments, and settings documents are all external
      // input. Loose access at those boundaries is exactly how a plugin starts
      // returning "undefined" instead of an error.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: false },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],

      // ── Explicit contracts ────────────────────────────────────────────────
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // ── House style that survives formatting ──────────────────────────────
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'no-implicit-coercion': 'error',
      'no-param-reassign': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],
      'sort-imports': ['error', { ignoreDeclarationSort: true }],
    },
  },

  // ── Tests may bend the strictness that exists to protect src/ ─────────────
  {
    files: ['test/**/*.ts'],
    rules: {
      // `node:test` registers suites and cases by calling describe/it at module
      // scope. Those return promises on purpose and awaiting them would be
      // wrong, so the rule that exists to protect production async code does
      // not apply here.
      '@typescript-eslint/no-floating-promises': 'off',
      // Test doubles are deliberately partial objects, and a fake that mirrors
      // an interface loosely needs casts and defensive branches the real types
      // would have already ruled out.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  // ── Hand-written ambient declarations describe other packages ─────────────
  {
    files: ['src/types/**/*.d.ts'],
    rules: {
      // These files declare other packages' surfaces, including generic type
      // parameters that appear once because that is how the real signature
      // reads. `tsc` already validates them, and the type-aware rules below
      // misfire on declaration merging rather than on a real defect.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/method-signature-style': 'off',
      'no-redeclare': 'off',
    },
  },

  // ── Node scripts and this config file are plain JavaScript tooling ────────
  {
    files: ['scripts/**/*.mjs', '*.mjs', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false },
      globals: {
        // The Node globals the build script and this config use directly.
        // Declared by name so no `globals` package is needed for two entries.
        URL: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },

  // Keep this last: it switches off every rule Prettier already guarantees.
  prettier,
)
