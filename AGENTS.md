# AI Assistant Guidance — Data Preparation Rules Template

This file is the **primary, tool-agnostic source of guidance** for any AI coding
assistant (GitHub Copilot, Claude, Cursor, etc.) working in this repository.
Tool-specific files such as `.github/copilot-instructions.md` are thin wrappers
that point here.

## What this repository is

A development template for authoring **Cumulocity Data Preparation rules** in an
IDE instead of the Cumulocity UI. Each rule transforms raw device messages
(e.g. MQTT payloads) into Cumulocity domain objects (measurements, alarms,
events, operations) — or sends messages back to devices.

Rules are written in **TypeScript** for full type-checking and IntelliSense, then
bundled to a single ES2023 Javascript file at deploy/test time.

## Repository layout

```
rules/<rule-name>/            # one folder per rule; folder name = rule name on the platform
  data-prep.yaml              # rule configuration (transport, topic, metadata)
  smartFunction.ts            # the rule logic — exports onMessage()
  tests/<name>.yaml           # platform test cases (one named test per file)
dataprep/dataprep.ts          # vendored copy of the @c8y/dataprep-types declarations
schemas/                      # JSON Schemas for offline validation of the YAML files
scripts/                      # validate / create-rule / test / deploy automation (Node ESM)
```

## The Smart Function runtime (CRITICAL for correct rule code)

The runtime executing `onMessage` is a **restricted Javascript sandbox**. It is
**not** Node.js and **not** a browser.

**Available:**
- ES2023 language features and standard built-in objects (`JSON`, `Math`, `Date`,
  `Array`, `Object`, `Map`, `Set`, `String`, `Number`, `RegExp`, etc.)
- Platform-provided globals: `console`, `TextDecoder`, `TextEncoder`
- Importable bundled libraries: `cbor2.js`, `protobufjs.js`

**NOT available — do not use these in rule code:**
- Network: `fetch`, `XMLHttpRequest`
- Timers: `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`
- Node.js APIs: `process`, `Buffer`, `require`, `module`, `__dirname`, `__filename`, `fs`, etc.
- Browser/DOM APIs (`window`, `document`, ...)
- Dynamic code execution: `eval`, `new Function`

`npm run lint` and `npm run check` flag most of these offline.

## The `onMessage` function

Every `smartFunction.ts` exports exactly one function with this signature:

```typescript
import type { DeviceMessage, DataPrepContext, CumulocityObject } from '@c8y/dataprep-types';

export function onMessage(msg: DeviceMessage, context: DataPrepContext): (CumulocityObject | DeviceMessage)[] {
  // decode msg.payload (a Uint8Array), build outputs, return them
  return [];
}
```

- **Input** `msg: DeviceMessage` — `payload` is a `Uint8Array` (decode with
  `new TextDecoder().decode(msg.payload)`); also `topic`, `transportID`, optional
  `clientID`, `time`, `transportFields`.
- **Output** — an array of `CumulocityObject` (`Measurement`, `Alarm`, `Event`,
  `Operation`) and/or `DeviceMessage` items. Each `CumulocityObject` must include an
  `externalSource` array identifying the device.
- Return `[]` to produce no output for a message.

## `data-prep.yaml` schema (summary)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `smartFunctionFile` | string | yes | The `.ts` file with `onMessage` (e.g. `smartFunction.ts`). |
| `input` | object | yes | `transport` (yes), `topicPattern` (yes — use `*` as wildcard, e.g. `sensors/*/temperature`; must not contain `**`; do not use MQTT `+`/`#`), `transportID` (optional — identifier for a specific transport instance; defaults to `transport` if omitted), `clientIDPattern` (optional — `*` as wildcard). |
| `description` | string | no | Human-readable description. |
| `tags` | string[] | no | Organisational tags. |
| `disabled` | boolean | no | Deploy as disabled (default `false`). |

Test files (`tests/<name>.yaml`): an `inputs` array (each item: `payload`, `topic`,
`clientID`, `time` required strings; `payloadFormat: json`), and an
optional `expectedOutput` array compared element-by-element when present.

The authoritative schemas live in `schemas/data-prep.schema.json` and
`schemas/test-case.schema.json`.

## npm scripts

| Command | What it does | Needs credentials |
|---------|--------------|-------------------|
| `npm run check` | TypeScript type-check (`tsc --noEmit`) | no |
| `npm run lint` | ESLint over `rules/` (restricted-runtime rules) | no |
| `npm run validate` | JSON Schema validation of all YAML files | no |
| `npm run create-rule -- <name>` | Scaffold a new rule folder | no |
| `npm run test [-- rules/<name>]` | Run platform tests via `/v1/run-tests` | yes |
| `npm run deploy [-- rules/<name>]` | Package + deploy via `PUT .../deployed` | yes |
| `npm run docs` | Generate the TypeScript API reference with TypeDoc | no |

## Credentials (for `test` / `deploy`)

Resolved token/session-first, basic auth only as fallback:
1. Host: `C8Y_HOST`, then `C8Y_BASEURL`, then `--host` CLI flag.
2. Authorization header: `C8Y_HEADER`, then `C8Y_HEADER_AUTHORIZATION`, then `--header`.
3. Basic fallback: only when both `C8Y_USER` and `C8Y_PASSWORD` are set.

This matches `c8ycli` session environment variables, so an existing `c8ycli`
session can be reused without re-entering credentials.

## Guidance for assistants

- Keep rule code inside the runtime constraints above — never suggest `fetch`,
  timers, or Node/browser APIs.
- Prefer typed imports from `@c8y/dataprep-types`.
- When adding a rule, use `npm run create-rule -- <name>` rather than hand-creating
  folders, then edit the generated files.
- Always run `npm run check`, `npm run lint`, and `npm run validate` before
  proposing a change is complete.
