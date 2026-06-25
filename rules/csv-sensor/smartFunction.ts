/**
 * Example rule: converts a pipe-delimited CSV text payload from an MQTT device
 * into one Cumulocity measurement per data row.
 *
 * Expected incoming payload (text):
 *   temp|hum\n22.5|45\n12.3|55\n
 *
 * The first line is treated as the header (column names); each subsequent line
 * becomes a separate measurement on the same device.
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, Measurement } from '@c8y/dataprep-types';

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const text = new TextDecoder().decode(msg.payload);
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('|').map((h) => h.trim());
  const deviceId = msg.clientID ?? msg.topic;
  const time = new Date(msg.time ?? Date.now());
  const results: CumulocityObject[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('|').map((v) => v.trim());
    const measurementPayload: { type: string; time: Date; [fragment: string]: unknown } = { type: 'c8y_SensorReading', time };

    for (let j = 0; j < headers.length; j++) {
      const val = parseFloat(values[j]);
      if (!isNaN(val)) {
        measurementPayload[headers[j]] = { value: val, unit: '' };
      }
    }

    const measurement: Measurement = {
      cumulocityType: 'measurement',
      externalSource: [{ externalId: deviceId, type: 'c8y_Serial' }],
      payload: measurementPayload,
    };
    results.push(measurement);
  }

  return results;
}
