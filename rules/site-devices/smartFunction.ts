/**
 * Example rule: records each temperature reading as a measurement, and uses onDeviceCreate to choose
 * what is created for a sensor Cumulocity doesn't know yet.
 *
 * A sensor that reports its site is created in the site's "Temperature sensors" group, and the site's
 * asset under its region's asset if reported. A sensor that reports no site isn't created, and its
 * readings are discarded.
 *
 * Expected incoming payload (JSON text):
 *   { "site": "North", "region": "East", "temperature": 21.5 }   (region optional, site optional)
 */
import type { DeviceMessage, DataPrepContext, CumulocityObject, ExternalId, CreateDevice, CreateAsset, CreateGroup } from '@c8y/dataprep-types';

interface Reading {
  site?: string;
  region?: string;
  temperature: number;
}

function sensorId(msg: DeviceMessage): ExternalId {
  return { type: 'c8y_Serial', externalId: msg.clientID ?? msg.topic };
}

export function onMessage(msg: DeviceMessage, context: DataPrepContext): CumulocityObject[] {
  const data: Reading = JSON.parse(new TextDecoder().decode(msg.payload));
  return [{
    cumulocityType: 'measurement',
    externalSource: [sensorId(msg)],
    payload: { type: 'acme_Temperature', time: msg.time ?? new Date(), acme_Temperature: { T: { value: data.temperature, unit: 'C' } } },
  }];
}

export function onDeviceCreate(msg: DeviceMessage, externalId: ExternalId, context: DataPrepContext): (CreateDevice | CreateAsset | CreateGroup)[] {
  const data: Reading = JSON.parse(new TextDecoder().decode(msg.payload));
  if (typeof data.site !== 'string') return [];

  // Parents come before their children, and are named as the objects themselves
  const created: (CreateDevice | CreateAsset | CreateGroup)[] = [];
  const site: CreateAsset = { cumulocityType: 'asset', externalAssetId: `site-${data.site.toLowerCase()}`, payload: { type: 'acme_Site', name: `Site ${data.site}` } };
  if (typeof data.region === 'string') {
    const region: CreateAsset = { cumulocityType: 'asset', externalAssetId: `region-${data.region.toLowerCase()}`, payload: { type: 'acme_Region', name: `Region ${data.region}` } };
    created.push(region);
    site.parentAssets = [region];
  }
  // Found by its path in the site, or created if missing
  const sensors: CreateGroup = { cumulocityType: 'group', groupPath: { rootAsset: site, path: ['Temperature sensors'] }, payload: {} };
  created.push(site, sensors, {
    cumulocityType: 'device',
    externalSource: [externalId],
    payload: { name: `Sensor ${externalId.externalId}`, type: 'acme_TemperatureSensor', c8y_Hardware: { serialNumber: externalId.externalId } },
    parentAssets: [sensors],
  });
  return created;
}
