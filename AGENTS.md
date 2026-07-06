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
schemas/                      # JSON Schemas for offline validation of the YAML files
scripts/                      # validate / create-rule / test / deploy automation (Node ESM)
```

## The Smart Function runtime (CRITICAL for correct rule code)

The runtime executing `onMessage` is a **restricted Javascript sandbox**. It is
**not** Node.js and **not** a browser.

**Available:**
- ES2023 language features and standard built-in objects (`JSON`, `Math`, `Date`,
  `Array`, `Object`, `Map`, `Set`, `String`, `Number`, `RegExp`, etc.)
- Platform-provided globals: `console`, `TextDecoder`, `TextEncoder`, `Base64`,
  `OPCUACodec` (see [Decoding binary payloads](#decoding-binary-payloads-codecs))
- Importable bundled codec libraries: `cbor2.js`, `protobufjs.js`

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

## Decoding binary payloads (codecs)

`msg.payload` is always a `Uint8Array`. How you turn it into usable data depends
on the format:

- **JSON / CSV / other text** — decode to a string first with
  `new TextDecoder().decode(msg.payload)`, then parse (`JSON.parse`, split on
  delimiters, etc.). No codec needed.
- **Binary formats** — use one of the four runtime-provided codecs below. Their
  full signatures are declared in `@c8y/dataprep-types`, so imports and method
  calls are type-checked by `npm run check` and autocomplete in the IDE.

Only these four codecs exist — do not assume any others. `atob`/`btoa` are **not**
available; use `Base64` instead.

### CBOR — `cbor2.js`

```typescript
import { decode } from 'cbor2.js';

const data = decode(msg.payload); // returns the decoded value
const temperature = data.temperature;
```

- `decode(payload: Uint8Array): any` — decode CBOR bytes.
- `encode(value: unknown): Uint8Array` — encode a value back to CBOR.
- On the decoded value use `.get(key)` **only for numeric keys**
  (e.g. `data.get(0)` — CBOR-encoded SenML uses numeric keys); otherwise use
  normal dot/bracket notation (`data.temperature`, `data['temperature']`).

### Protobuf — `protobufjs.js`

```typescript
import protobuf from 'protobufjs.js';

const schema = `syntax = "proto3"; message Reading { double temp = 1; }`;
const root = protobuf.parse(schema).root;
const Reading = root.lookupType('Reading');
const decoded = Reading.decode(msg.payload);
const obj = Reading.toObject(decoded); // { temp: ... }
```

- `protobuf.parse(source: string)` → `{ root, package }`. The schema string must
  be valid `.proto` syntax (declare `syntax = "proto3";`).
- `root.lookupType(name)` → a message type with `decode(payload)`, `encode(msg)`,
  and `toObject(decoded)`.
- `toObject(decoded)` converts snake_case schema fields into camelCase properties.

### Base64 — `Base64` global (no import)

```typescript
const bytes = Base64.decode('SGVsbG8=');     // Uint8Array
const str   = Base64.decodeStr('SGVsbG8=');  // "Hello"
```

- `decode(bstr: string): Uint8Array` / `encode(buffer: Uint8Array): string`.
- `decodeStr(bstr: string): string` / `encodeStr(str: string): string` — operate
  on plain strings rather than byte arrays.
- Capitalisation matters: it is `Base64`, not `base64`.

### OPC UA — `OPCUACodec` global (no import)

```typescript
const codec = new OPCUACodec();
const variant = codec.decode(msg.payload);
const value = variant.Value;
```

- `decode(payload)` / `encode(payload)` — for an OPC UA `Variant`.
- `decodeDataValue(payload)` / `encodeDataValue(payload)` — for a `DataValue`.
- Decoded objects have **capitalised** members and contain ONLY the members of
  the Variant/DataValue (e.g. `Value`, `StatusCode`, `SourceTimestamp`).

## `data-prep.yaml` schema (summary)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `smartFunctionFile` | string | yes | The `.ts` file with `onMessage` (e.g. `smartFunction.ts`). |
| `input` | object | yes | `transport` (yes), `topicPattern` (yes — use `*` as wildcard, e.g. `sensors/*/temperature`; must not contain `**`; do not use MQTT `+`/`#`), `clientIDPattern` (optional — `*` as wildcard). |
| `description` | string | no | Human-readable description. |
| `tags` | string[] | no | Organisational tags. |
| `disabled` | boolean | no | Deploy as disabled (default `false`). |

Test files (`tests/<name>.yaml`): an `inputs` array (each item: `payload`, `topic`,
`clientID`, `time` required strings; `payloadFormat: json | base64 | text`), and an
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
- For binary payloads, use only the four codecs in
  [Decoding binary payloads](#decoding-binary-payloads-codecs) (`cbor2.js`,
  `protobufjs.js`, `Base64`, `OPCUACodec`) — never `atob`/`btoa` or invented codecs.
- When adding a rule, use `npm run create-rule -- <name>` rather than hand-creating
  folders, then edit the generated files.
- Always run `npm run check`, `npm run lint`, and `npm run validate` before
  proposing a change is complete.

@node_modules/@c8y/dataprep-types/index.d.ts