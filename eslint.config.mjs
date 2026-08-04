import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      // Stryker copies the whole project into here to mutate it. Linting a
      // sandbox means linting a second, deliberately broken copy of the source.
      '.stryker-tmp/**',
      'reports/**',
      // Vendored agent-skill templates. They are documentation for a tool, not
      // code this repo ships, and linting someone else's template teaches us
      // nothing about our own.
      '.claude/**',
      '.agents/**',
      // Node build scripts: they run under Node, not in the app's environment,
      // and the shared config assumes the latter.
      '**/scripts/build-css.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Unused arguments are meaningful when implementing an interface — an
      // adapter method that ignores its input still has to declare it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Anchor payloads are genuinely unknown until parsed; `any` is not.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    files: ['apps/hub/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    // Scripts are operator tools: they read env, print, and exit.
    files: ['scripts/**/*.ts', 'apps/sample-remit/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
);
