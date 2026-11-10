/**
 * Example rule: records each sensor reading a gateway forwards as a measurement, and uses onDeviceCreate
 * to create the gateway and its sensors as its child devices.
 *
 * The first missing sensor's call returns the gateway and every sensor in the message, so the other
 * sensors need no call of their own. A gateway that already exists is reused, not created again.
 *
 * Expected incoming payload (JSON text), sent with the gateway's serial as the client ID:
 *   { "sensors": [{ "id": "s1", "temperature": 21.5 }, { "id": "s2", "temperature": 19 }] }
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, ExternalId, CreateDevice, CreateAsset, CreateGroup } from '@c8y/dataprep-types';

interface GatewayReadings {
  sensors: { id: string; temperature: number }[];
}

function readings(msg: DeviceMessage): GatewayReadings {
  return JSON.parse(new TextDecoder().decode(msg.payload));
}

function serial(id: string): ExternalId {
  return { type: 'c8y_Serial', externalId: id };
}

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  return readings(msg).sensors.map((sensor) => ({
    cumulocityType: 'measurement',
    externalSource: [serial(sensor.id)],
    payload: { type: 'acme_Temperature', time: msg.time ?? new Date(), acme_Temperature: { T: { value: sensor.temperature, unit: 'C' } } },
  }));
}

export function onDeviceCreate(msg: DeviceMessage, externalId: ExternalId, context: DataPrepContext): (CreateDevice | CreateAsset | CreateGroup)[] {
  const gateway = serial(msg.clientID ?? msg.topic);
  return [
    { cumulocityType: 'device', externalSource: [gateway], payload: { name: `Gateway ${gateway.externalId}`, type: 'acme_Gateway' } },
    ...readings(msg).sensors.map((sensor): CreateDevice => ({
      cumulocityType: 'device',
      externalSource: [serial(sensor.id)],
      payload: { name: `Sensor ${sensor.id}`, type: 'acme_TemperatureSensor' },
      parentDevice: gateway,
    })),
  ];
}
