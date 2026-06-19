// ESLint flat config for Data Preparation rule source.
//
// Smart Functions run in a restricted Javascript environment that is *not*
// Node.js and *not* a browser. Only ES2023 language built-ins plus a small set
// of platform-provided globals (`console`, `TextDecoder`, `TextEncoder`) are
// available. This config flags the most common globals that developers reach
// for out of habit but which are NOT available at runtime, so mistakes are
// caught offline (`npm run lint`) rather than at deploy/test time.

import tseslint from 'typescript-eslint';

/**
 * Globals that exist in Node.js and/or the browser but are unavailable in the
 * Smart Function runtime. Using any of these is almost always a mistake.
 */
const FORBIDDEN_GLOBALS = [
  { name: 'fetch', message: 'Network access (fetch) is not available in the Smart Function runtime.' },
  { name: 'setTimeout', message: 'Timers (setTimeout) are not available in the Smart Function runtime.' },
  { name: 'setInterval', message: 'Timers (setInterval) are not available in the Smart Function runtime.' },
  { name: 'clearTimeout', message: 'Timers (clearTimeout) are not available in the Smart Function runtime.' },
  { name: 'clearInterval', message: 'Timers (clearInterval) are not available in the Smart Function runtime.' },
  { name: 'process', message: 'Node.js APIs (process) are not available in the Smart Function runtime.' },
  { name: 'Buffer', message: 'Node.js APIs (Buffer) are not available; use TextDecoder/TextEncoder.' },
  { name: 'require', message: 'CommonJS require is not available; use ES module import syntax.' },
  { name: 'module', message: 'CommonJS module is not available in the Smart Function runtime.' },
  { name: '__dirname', message: 'Node.js APIs (__dirname) are not available in the Smart Function runtime.' },
  { name: '__filename', message: 'Node.js APIs (__filename) are not available in the Smart Function runtime.' },
];

export default tseslint.config(
  {
    files: ['rules/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // Deliberately do NOT register Node.js or browser global sets here:
      // only ES2023 language built-ins and the platform-provided globals below
      // are available at runtime.
      globals: {
        console: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
      },
    },
    rules: {
      'no-restricted-globals': ['error', ...FORBIDDEN_GLOBALS],
      // onMessage(msg, context) is a fixed signature; `context` is frequently
      // unused, so don't flag unused function arguments. Unused local variables
      // are still flagged (underscore-prefixed names are ignored).
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
    },
  },
);
