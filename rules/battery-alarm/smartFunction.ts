/**
 * Example rule: raises a Cumulocity alarm when a device reports a battery
 * level below a threshold, and produces no output otherwise.
 *
 * Expected incoming payload (JSON text):
 *   { "battery": 15 }
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, Alarm } from '@c8y/dataprep-types';

interface BatteryPayload {
  battery?: number;
}

const LOW_BATTERY_THRESHOLD = 20;
const CRITICAL_BATTERY_THRESHOLD = 5;

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const text = new TextDecoder().decode(msg.payload);
  const data: BatteryPayload = JSON.parse(text);

  if (data.battery == null || data.battery >= LOW_BATTERY_THRESHOLD) {
    return [];
  }

  const deviceId = msg.clientID ?? msg.topic;
  const alarm: Alarm = {
    cumulocityType: 'alarm',
    externalSource: [{ externalId: deviceId, type: 'c8y_Serial' }],
    payload: {
      type: 'c8y_BatteryAlarm',
      text: `Battery level low: ${data.battery}%`,
      severity: data.battery < CRITICAL_BATTERY_THRESHOLD ? 'CRITICAL' : 'MAJOR',
      time: msg.time ?? new Date(),
    },
  };

  return [alarm];
}
