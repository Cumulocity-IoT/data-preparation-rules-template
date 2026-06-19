/**
 * Example rule: converts a JSON temperature/humidity payload from an MQTT
 * device into Cumulocity measurements.
 *
 * Expected incoming payload (JSON text):
 *   { "temperature": 25.5, "humidity": 60 }
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, Measurement } from '@c8y/dataprep-types';

interface WeatherPayload {
  temperature?: number;
  humidity?: number;
}

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const text = new TextDecoder().decode(msg.payload);
  const data: WeatherPayload = JSON.parse(text);

  const deviceId = msg.clientID ?? msg.topic;
  const time = msg.time ?? new Date();
  const results: CumulocityObject[] = [];

  if (data.temperature != null) {
    const measurement: Measurement = {
      cumulocityType: 'measurement',
      externalSource: [{ externalId: deviceId, type: 'c8y_Serial' }],
      payload: {
        type: 'c8y_Weather',
        time,
        c8y_Temperature: {
          T: { value: data.temperature, unit: '°C' },
        },
      },
    };
    results.push(measurement);
  }

  if (data.humidity != null) {
    const measurement: Measurement = {
      cumulocityType: 'measurement',
      externalSource: [{ externalId: deviceId, type: 'c8y_Serial' }],
      payload: {
        type: 'c8y_Weather',
        time,
        c8y_Humidity: {
          H: { value: data.humidity, unit: '%' },
        },
      },
    };
    results.push(measurement);
  }

  if (results.length === 0) {
    console.warn('No recognised fields in payload');
  }

  return results;
}
