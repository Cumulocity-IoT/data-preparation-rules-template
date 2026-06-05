/**
 * Example data preparation rule: converts a JSON text payload
 * from an MQTT device into a Cumulocity Measurement.
 *
 * Expected incoming payload (JSON text):
 *   { "temperature": 25.5, "humidity": 60 }
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, Measurement } from '../../dataprep/dataprep';

interface WeatherPayload {
  temperature?: number;
  humidity?: number;
}

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const text = new TextDecoder().decode(msg.payload);
  const data: WeatherPayload = JSON.parse(text);

  const results: CumulocityObject[] = [];

  // Create a temperature measurement if present
  if (data.temperature != null) {
    const measurement: Measurement = {
      cumulocityType: 'measurement',
      externalSource: [{ externalId: msg.topic, type: 'c8y_Serial' }],
      payload: {
        type: 'c8y_Weather',
        time: msg.time || new Date(),
        c8y_Temperature: {
          T: { value: data.temperature, unit: '°C' },
        },
      },
    };
    results.push(measurement);
  }

  // Create a humidity measurement if present
  if (data.humidity != null) {
    const measurement: Measurement = {
      cumulocityType: 'measurement',
      externalSource: [{ externalId: msg.topic, type: 'c8y_Serial' }],
      payload: {
        type: 'c8y_Weather',
        time: msg.time || new Date(),
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
