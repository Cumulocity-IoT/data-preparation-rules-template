/**
 * Example rule: records each temperature reading as a measurement, and uses onDeviceCreate to choose
 * what is created for a sensor Cumulocity doesn't know yet.
 *
 * A sensor that reports its site is created under that site's asset, and the site under its region's
 * asset if reported. A sensor that reports no site isn't created, and its readings are discarded.
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

  // Parents come before their children
  const created: (CreateDevice | CreateAsset | CreateGroup)[] = [];
  const site: ExternalId = { type: 'acme_SiteId', externalId: data.site.toLowerCase() };
  const siteAsset: CreateAsset = { cumulocityType: 'asset', externalSource: [site], payload: { type: 'acme_Site', name: `Site ${site.externalId}` } };
  if (typeof data.region === 'string') {
    const region: ExternalId = { type: 'acme_RegionId', externalId: data.region.toLowerCase() };
    created.push({ cumulocityType: 'asset', externalSource: [region], payload: { type: 'acme_Region', name: `Region ${region.externalId}` } });
    siteAsset.parentAssets = [region];
  }
  created.push(siteAsset);
  created.push({
    cumulocityType: 'device',
    externalSource: [externalId],
    payload: { name: `Sensor ${externalId.externalId}`, type: 'acme_TemperatureSensor', c8y_Hardware: { serialNumber: externalId.externalId } },
    parentAssets: [site],
  });
  return created;
}
