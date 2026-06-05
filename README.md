# Cumulocity Data Preparation Rules

This project is a development template for creating, testing, and deploying data preparation rules for Cumulocity IoT. Rules transform raw device messages (e.g. MQTT payloads) into Cumulocity domain objects (measurements, events, alarms) and vice versa.

Rules are written in **TypeScript** with full type checking and IntelliSense in VS Code. TypeScript is transpiled to JavaScript automatically during deployment and platform testing.

## Installation and Setup

The project requires [Node.js](https://nodejs.org/) (v18+) and [npm](https://www.npmjs.com/).

Install dependencies:

```bash
npm install
```

## Project Structure

```
rules/
  weather-measurements/   # Each folder is one rule (folder name = rule name)
    data-prep.yaml        # Rule configuration
    smartFunction.ts      # Smart function implementation (TypeScript)
    tests/                # Platform test definitions (YAML)
  battery-alarm/
    data-prep.yaml
    smartFunction.ts
    tests/
dataprep/                 # Types (do not modify)
  dataprep.ts            # Exported types: DeviceMessage, Measurement, Alarm, etc.
scripts/                  # Automation scripts
  test.js               # Executes platform tests via run-tests endpoint
  deploy.js             # Builds tar.gz and deploys to platform
```

Each rule lives in its own folder under `rules/`. The folder name is used as the rule name when deploying.

## Developer Flow

The developer workflow consists of offline checks (fast, no credentials) and platform operations (require a live Cumulocity environment):

```bash
npm run check        # TypeScript type checking (offline)
npm run test         # Platform tests via run-tests API (requires credentials)
npm run deploy       # Build tar.gz and deploy to platform (requires credentials)
```

Type checking catches type mistakes and incorrect API usage entirely offline. Platform tests provide authoritative correctness validation against the real runtime.

## Writing Rules

### Rule Function Signature

Every rule file must export an `onMessage` function:

```typescript
export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  // Your rule logic here
  return [/* CumulocityObject or DeviceMessage items */];
}
```

### Execution Environment

The smart function runtime is a restricted JavaScript environment. It is **not** Node.js.

**Available:**
- ES2023 language features and standard built-in objects
- Platform-provided built-ins: `TextDecoder`, `TextEncoder`, `console`
- Importable libraries: `cbor2.js`, `protobufjs.js`

**Not available:**
- Node.js APIs (`process`, `require`, `fs`, `Buffer`, etc.)
- Browser/Web APIs (`fetch`, `setTimeout`, `XMLHttpRequest`, DOM, etc.)
- Dynamic code execution (`eval`, `new Function`)

### Input: DeviceMessage

The `msg` parameter contains:
- `payload` — `Uint8Array` containing the raw device data. Use `new TextDecoder().decode(msg.payload)` for text formats.
- `topic` — The transport topic (e.g. MQTT topic).
- `transportID` — Identifier for the transport (e.g. `"mqtt"`).
- `time` — Optional timestamp of the incoming message.
- `transportFields` — Optional dictionary of transport-specific fields.

### Output: CumulocityObject / DeviceMessage

The function returns an array of objects to create in Cumulocity. Available types:
- **`Measurement`** — Time-series data (e.g. temperature, pressure).
- **`Alarm`** — Alert conditions (e.g. high temperature warning).
- **`Event`** — Discrete occurrences (e.g. door opened).
- **`Operation`** — Device control commands.
- **`DeviceMessage`** — Send data back to a device.

Each `CumulocityObject` must include an `externalSource` array to identify the device.

### Type Checking

The type declarations in `dataprep/dataprep.ts` export `DeviceMessage`, `Measurement`, `Alarm`, `Event`, `Operation`, `CumulocityObject`, and `DataPrepContext`. Import the types you need at the top of your rule file:

```typescript
import type { DeviceMessage, DataPrepContext, CumulocityObject, Measurement } from '../../dataprep/dataprep';
```

Then use standard TypeScript type annotations:

```typescript
const measurement: Measurement = {
  cumulocityType: 'measurement',
  externalSource: [{ externalId: msg.topic, type: 'c8y_Serial' }],
  payload: {
    type: 'c8y_Temperature',
    time: msg.time || new Date(),
    c8y_Temperature: {
      T: { value: 25.5, unit: '°C' },
    },
  },
};
```

You can also define interfaces for your incoming payloads:

```typescript
interface SensorPayload {
  temperature?: number;
  humidity?: number;
}

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const text = new TextDecoder().decode(msg.payload);
  const data: SensorPayload = JSON.parse(text);
  // data.temperature and data.humidity are now type-checked
}
```

Run the type checker across all files:

```bash
npm run check
```

## Testing

All testing is done via the platform's existing run-tests endpoint. There is no local test sandbox — the platform is the authoritative runtime and the single source of truth for rule behaviour.

### Setup

The test script needs a Cumulocity base URL and credentials. The authenticated user must have the `DATA_PREPARATION_RULES_ADMIN` role.

Set credentials as environment variables in your shell session:

```bash
export C8Y_BASEURL=https://mytenant.cumulocity.com
export C8Y_USER=myuser
export C8Y_PASSWORD=$(read -rs -p "Password: " p && echo "$p")
```

The `read -s` flag suppresses echoing so the password never appears on screen, and using command substitution keeps it out of your shell history.

### Test Definitions

Platform tests are defined as individual YAML files in a `tests/` directory within each rule folder. Each file defines one test with its input messages:

```yaml
# tests/temperature-only.yaml
inputs:
  - payload: '{"temperature": 25.5}'
    payloadFormat: json
    topic: "devices/sensor01/data"
    time: "2026-01-01T12:00:00Z"
```

Each input has these fields:
- `payload` — The message payload as a string.
- `topic` — **(required)** The transport topic.
- `payloadFormat` — `"json"` (currently the only supported format).
- `clientID` — Client identifier (default: `""`).
- `time` — ISO timestamp (default: current time).
- `transportID` — Transport identifier (default: `""`).

### Running Tests

```bash
# Test a single rule:
npm run test -- rules/weather-measurements

# Test all rules:
npm run test
```

The script transpiles the TypeScript to JavaScript, sends it along with the test inputs to the platform's run-tests endpoint, and reports pass/fail status, generated outputs, and any captured console logs.

### GitHub Actions

The included CI workflow (`.github/workflows/ci.yml`) runs type checking on every push. Platform tests can be triggered manually via `workflow_dispatch` — configure these repository secrets:

- `C8Y_BASEURL` — Cumulocity base URL
- `C8Y_USER` — Username
- `C8Y_PASSWORD` — Password

## Deploying

Deploy a rule to a Cumulocity platform using the deploy script. This type-checks, transpiles the TypeScript to JavaScript, packages the rule folder contents (data-prep.yaml, compiled JS, and tests) into a tar.gz archive, and deploys it via `PUT /rules/{ruleName}/deployed`.

### Configuration

Each rule folder must contain a `data-prep.yaml`:

```yaml
description: "My rule description"
tags:
  - my-tag
smartFunctionFile: "smartFunction.ts"
input:
  transport: mqtt
  topicPattern: "devices/*/data"
  clientIDPattern: "*"
```

Fields:
- `smartFunctionFile` — **(required)** The `.ts` file containing the `onMessage` function.
- `input` — **(required)** Defines which messages the rule receives:
  - `transport` — Transport type (e.g. `mqtt`).
  - `topicPattern` — Topic filter pattern (supports `*` wildcards).
  - `clientIDPattern` — Client ID filter pattern (supports `*` wildcards).
- `description` — Human-readable description.
- `tags` — List of tags for organising rules.
- `disabled` — Set to `true` to prevent the rule from activating on deploy (default: `false`).

### Running deploy

Set credentials and run:

```bash
export C8Y_BASEURL=https://mytenant.cumulocity.com
export C8Y_PASSWORD=$(read -rs -p "Password: " p && echo "$p")

# Deploy a single rule:
npm run deploy -- rules/weather-measurements

# Deploy all rules:
npm run deploy
```

The rule name is the folder name (e.g. `weather-measurements`).
