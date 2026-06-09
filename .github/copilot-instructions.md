# GitHub Copilot Instructions

The authoritative, tool-agnostic guidance for this repository lives in
[`AGENTS.md`](../AGENTS.md). Read it first and follow it.

Key reminders for Smart Function (`rules/**/smartFunction.ts`) code:

- The runtime is a **restricted JavaScript sandbox** — not Node.js, not a browser.
  Do **not** use `fetch`, timers (`setTimeout`/`setInterval`), `process`, `Buffer`,
  `require`, `module`, `__dirname`, `__filename`, DOM/browser APIs, `eval`, or
  `new Function`.
- Available globals: ES2023 built-ins plus `console`, `TextDecoder`, `TextEncoder`.
- Import types from `@c8y/dataprep-types`; export a single `onMessage(msg, context)`
  returning an array of `CumulocityObject` / `DeviceMessage`.
- Before finishing, ensure `npm run check`, `npm run lint`, and `npm run validate` pass.

See [`AGENTS.md`](../AGENTS.md) for the full schema, runtime details, and workflow.
