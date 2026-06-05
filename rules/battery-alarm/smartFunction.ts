/**
 * Battery alarm rule: raises a Cumulocity alarm when a device
 * reports battery level below a threshold.
 *
 * Expected incoming payload (JSON text):
 *   { "battery": 15 }
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, Measurement, Alarm } from '../../dataprep/dataprep';

interface BatteryPayload {
  battery?: number;
}

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const text = new TextDecoder().decode(msg.payload);
  const data: BatteryPayload = JSON.parse(text);

  if (data.battery == null) {
    return [];
  }

  const results: CumulocityObject[] = [];

  // Create a battery measurement
  const measurement: Measurement = {
    cumulocityType: 'measurement',
    externalSource: [{ externalId: msg.topic, type: 'c8y_Serial' }],
    payload: {
      type: 'c8y_Battery',
      time: msg.time || new Date(),
      c8y_Battery: {
        level: { value: data.battery, unit: '%' },
      },
    },
  };
  results.push(measurement);

  // Raise alarm if battery is critically low
  if (data.battery < 20) {
    const alarm: Alarm = {
      cumulocityType: 'alarm',
      externalSource: [{ externalId: msg.topic, type: 'c8y_Serial' }],
      payload: {
        type: 'c8y_BatteryAlarm',
        text: `Battery level critical: ${data.battery}%`,
        severity: data.battery < 5 ? 'CRITICAL' : 'MAJOR',
        time: msg.time || new Date(),
      },
    };
    results.push(alarm);
  }

  return results;
}
