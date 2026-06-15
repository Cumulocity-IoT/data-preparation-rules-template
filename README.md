# Cumulocity Data Preparation Rules — Development Template

Develop, validate, test, and deploy **Cumulocity Data Preparation rules** from your
IDE instead of the Cumulocity UI. Rules transform raw device messages (e.g. MQTT
payloads) into Cumulocity domain objects — measurements, alarms, events, operations —
or send messages back to devices.

Rules are written in **TypeScript** with full type-checking and IntelliSense, and
bundled to a single ES2023 JavaScript file automatically at test/deploy time.

> For the full feature overview and platform integration details, see the
> [Data Preparation product documentation](https://cumulocity.com/guides/).

## Quick start

```bash
npm install                                         # 1. install tooling
npm run create-rule -- my-rule                      # 2. scaffold a new rule
npm run check && npm run lint && npm run validate   # 3. offline checks
npm run test  -- rules/my-rule                      # 4. run platform tests (needs credentials)
npm run deploy -- rules/my-rule                     # 5. deploy to your tenant
```

## 1. Prerequisites

- **Node.js 22+** and npm.
- A **Cumulocity tenant** with the Data Preparation microservice subscribed, and a
  user with the `DATA_PREPARATION_RULES_ADMIN` role (plus `DEPLOYMENTS_ADMIN` to deploy).
- **VS Code** recommended (this repo ships workspace settings and extension
  recommendations for ESLint and YAML schema validation).

See the [Data Preparation product documentation](https://cumulocity.com/guides/) for
platform setup.

## 2. Getting started

1. **Fork or clone** this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Open the folder in VS Code and install the recommended extensions when prompted.

## 3. Creating a rule

```bash
npm run create-rule -- my-rule
```

This scaffolds `rules/my-rule/` containing `data-prep.yaml`, `smartFunction.ts`, and
`tests/example.yaml`. The folder name becomes the rule name on the platform, so it
must not contain any of these characters:

```
/   \   *   ?   "   '   `   |   %   \0 (null)
```

## 4. Writing the Smart Function

Each rule exports a single `onMessage` function:

```typescript
import type { DeviceMessage, DataPrepContext, CumulocityObject } from '@c8y/dataprep-types';

export function onMessage(msg: DeviceMessage, context: DataPrepContext): (CumulocityObject | DeviceMessage)[] {
  const text = new TextDecoder().decode(msg.payload);
  const data = JSON.parse(text);
  // ... build outputs ...
  return [];
}
```

The Smart Function runs in a **restricted runtime** — not Node.js, not a browser.

- **Available:** ES2023 built-ins, `console`, `TextDecoder`, `TextEncoder`, and the
  importable bundled libraries `cbor2.js` and `protobufjs.js`.
- **Not available:** `fetch`, timers (`setTimeout`/`setInterval`), `process`, `Buffer`,
  `require`, DOM/browser APIs, `eval`/`new Function`. `npm run lint` flags these.

Types come from the [`@c8y/dataprep-types`](https://www.npmjs.com/package/@c8y/dataprep-types)
package. See the published **[TypeScript API reference (TypeDoc)](https://cumulocity-iot.github.io/datapreparation-rules-template/)**
and the Smart Function section of the
[Cumulocity Data Preparation product docs](https://cumulocity.com/guides/) for the
available types and runtime details.

## 5. Configuring `data-prep.yaml`

```yaml
smartFunctionFile: "smartFunction.ts"   # required: file containing onMessage
input:                                  # required
  transport: mqtt                       # required (currently only "mqtt")
  topicPattern: "devices/*/data"        # required
  clientIDPattern: "*"                  # optional
description: "What this rule does"      # optional
tags: ["example"]                       # optional
disabled: false                         # optional (default false)
```

The authoritative schema is in [`schemas/data-prep.schema.json`](schemas/data-prep.schema.json).
With the recommended VS Code YAML extension you get inline validation and completion.

## 6. Writing tests

Each file under a rule's `tests/` folder is one named test case (the filename without
extension is the test name):

```yaml
# rules/my-rule/tests/basic.yaml
inputs:
  - payload: '{"temperature": 23.5}'
    payloadFormat: json          # only "json" currently supported
    topic: "devices/device01/data"
    clientID: "device01"
    time: "2026-01-01T12:00:00.000Z"

expectedOutput:                  # optional
  - cumulocityType: measurement
    externalSource:
      - externalId: device01
        type: c8y_Serial
    payload:
      type: c8y_Temperature
      time: "2026-01-01T12:00:00.000Z"
      c8y_Temperature:
        T:
          value: 23.5
          unit: "°C"
```

A test **passes** if no runtime error occurs. If `expectedOutput` is present, the
actual outputs must additionally match it element-by-element (canonical JSON). See the
[`weather-measurements`](rules/weather-measurements) and
[`battery-alarm`](rules/battery-alarm) example rules.

## 7. Offline validation (no credentials)

```bash
npm run check      # TypeScript type-checking (tsc --noEmit)
npm run lint       # ESLint — flags use of unavailable runtime globals
npm run validate   # JSON Schema validation of every data-prep.yaml and test file
```

These run in CI on every push and pull request.

## 8. Running tests against the platform

```bash
npm run test                    # all rules
npm run test -- rules/my-rule   # one rule
```

Credentials are resolved **token/session first**, with basic auth as a fallback:

| Purpose | Sources (in order) |
|---------|--------------------|
| Host | `C8Y_HOST`, then `C8Y_BASEURL`, then `--host <url>` |
| Authorization header | `C8Y_HEADER`, then `C8Y_HEADER_AUTHORIZATION`, then `--header "Authorization: ..."` |
| Basic fallback | `C8Y_USER` + `C8Y_PASSWORD` (only if no header is set) |

Because the host/header variables match the [`c8ycli`](https://www.npmjs.com/package/@c8y/cli)
session environment, an existing `c8ycli` session can be reused without re-entering
credentials. To avoid storing a password on disk:

```bash
export C8Y_HOST=https://mytenant.cumulocity.com
export C8Y_USER=myuser
export C8Y_PASSWORD=$(read -rs -p "Password: " p && echo "$p")
npm run test
```

## 9. Deploying

```bash
npm run deploy                    # all rules
npm run deploy -- rules/my-rule   # one rule
```

`deploy` validates all selected rules offline first, then bundles each rule
(`data-prep.yaml` + compiled `.js` + `tests/*.yaml`) into a `tar.gz` and uploads it via
`PUT /service/dataprep/v1/rules/<name>/deployed`. The rule name is the folder name.

## 10. CI/CD

- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `check`, `lint`,
  and `validate` on Node 22+ for every push and pull request. A manual
  `workflow_dispatch` option can additionally run platform tests.
- **CD** ([`.github/workflows/cd.yml`](.github/workflows/cd.yml)) runs the offline
  checks, then `test` and `deploy`, on manual dispatch or when a release is published.

Configure these repository secrets (token-first preferred, basic as fallback):

| Secret | Purpose |
|--------|---------|
| `C8Y_HOST` | Tenant base URL |
| `C8Y_HEADER_AUTHORIZATION` | Authorization header (preferred) |
| `C8Y_BASEURL`, `C8Y_USER`, `C8Y_PASSWORD` | Basic auth fallback |

## 11. Updating the TypeScript types

The type declarations are published as [`@c8y/dataprep-types`](https://www.npmjs.com/package/@c8y/dataprep-types)
and kept up to date here automatically. To pull the latest types manually:

```bash
npm install @c8y/dataprep-types@latest
```

---

## Repository layout

```
rules/<rule-name>/        one folder per rule (folder name = rule name)
  data-prep.yaml          rule configuration
  smartFunction.ts        the onMessage implementation
  tests/<name>.yaml       platform test cases
dataprep/dataprep.ts      vendored copy of the @c8y/dataprep-types declarations
schemas/                  JSON Schemas used by `npm run validate` and the YAML editor
scripts/                  validate / create-rule / test / deploy automation
```

See [`AGENTS.md`](AGENTS.md) for AI-assistant guidance and a concise runtime reference.
