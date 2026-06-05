/** A (Pulsar) message received from a device or sent to a device */
export interface DeviceMessage {
  /** Always gets a byte array */
  payload: Uint8Array;

  /** Mandatory identifier for the source/dest transport e.g. "mqtt", "opc-ua" etc.*/
  transportID: string;
  
  /** Transport client the message was received from or will be delivered to. Don't set for broadcast. */
  clientID?: string;

  /** The topic on the transport (e.g. MQTT topic, or equivalent concept such as path for other transports). */
  topic: string;

  /** Optional dictionary of transport (e.g. MQTT-specific) fields/properties/headers. Values are strings. */
  transportFields?: { [key: string]: any };

  /** Timestamp of incoming Pulsar message (does not need to be set when sending) */
  time?: Date;
}

/** A create/update to a Cumulocity domain object. 
*/
export interface CumulocityObject {
  /** A payload (similar to the WebSDK and/or to that uses in the C8Y REST/SmartREST API). Specialized by subinterfaces.
   * Main difference is ID handling - when providing an externalSource you don't need to provide an "id" in the payload as you would in those APIs. 
   */
  payload: object;

  /** Which type in the Cumulocity API is being modified, e.g. "measurement", "alarm", etc. 
   */
  cumulocityType: string; // actually 'measurement' | 'event' | 'alarm' | 'operation';

  /** Since we usually don't know the C8Y ID to put in the payload, 
   * the data preparation rule can specify a single external ID to lookup (and optionally create). 
   * it is mandatory to include one item when sending this (unless the internal C8Y "id" is known and passed in the payload, or it's an operation where there's a dedicated field). 
   * When a Cumulocity message (e.g. operation) is received, this will contain a list of ALL external ids for this Cumulocity device.
   */
  externalSource: ExternalId[];

  /* For advanced cases only: */

  /** For messages sent by data preparation, this is "cumulocity" by default, but can be set to other options for other destinations. 
   * For messages received by data preparation this is not set.
   */
  destination?: string; // actually: "cumulocity" | "iceflow" | "streaming-analytics";
}

/** Details of external ID which will be looked up by data preparation to get the C8Y id. */
export interface ExternalId {
  /** External id to be looked up and/or created to get C8Y "id" */
  externalId: string;
  /** External id type e.g. "c8y_Serial" */
  type: string;
}

/**
 * Creates a Cumulocity Measurement. Extends the base {@link CumulocityObject}.
 * @remarks
 * This interface models a measurement as received or sent to the Cumulocity platform.
 * The `payload` contains the measurement details, including its type, timestamp, and
 * any number of custom fragments representing measurement series or additional data.
 *
 * @property cumulocityType - Discriminator for the measurement type, always "measurement".
 * @property payload - The measurement data, including type, time, and custom fragments.
 * @property payload.[fragment] - Custom fragments representing measurement series or other data.
 * - If the fragment is a measurement series, it is an object mapping series names to {@link MeasurementValue}.
 * - Otherwise, it can be any custom data relevant to the measurement.
 */
export interface Measurement extends CumulocityObject {
  cumulocityType: "measurement";

  payload: {
    type: string;
    time: Date;

    [fragment: string]:
      | { [series: string]: MeasurementValue }
      | any; // any = for custom fragments
  };
}

export interface MeasurementValue {
  value: number;
  unit?: string;
  [key: string]: any;
}

/** Create a new alarm. This cannot be used to update an existing alarm - that is not yet supported. */
export interface Alarm extends CumulocityObject {
  cumulocityType: "alarm";
  payload: {
    type: string;

    /* On creation these are mandatory
     */
    time?: Date;
    severity?: "CRITICAL" | "MAJOR" | "MINOR" | "WARNING";
    text?: string;

    [fragment: string]: any;
  };
}

/** 
 * Creates a Cumulocity Event. Extends the base {@link CumulocityObject}.
 * @remarks
 * Events are used to pass real-time information through Cumulocity (e.g. "Door opened", "Location updated").
 */
export interface Event extends CumulocityObject {
  cumulocityType: "event";

  payload: {
    type: string;
    text: string;
    time: Date;

    /** Custom fragments or standard fragments (e.g. c8y_Position). */
    [fragment: string]: any;
  };
}

/**
 * Creates a Cumulocity Operation. Extends the base {@link CumulocityObject}.
 * @remarks
 * Operations are generally used for device control. 
 */
export interface Operation extends CumulocityObject {
  cumulocityType: "operation";

  payload: {
    /** The state of the operation. */
    status?: "PENDING" | "SUCCESSFUL" | "FAILED" | "EXECUTING";
    
    description?: string;

    /* The operation details/fragments (e.g. c8y_Restart, c8y_Firmware). */
    [fragment: string]: any;
  };
}

/** Context passed when using data preparation. */
export interface DataPrepContext {
  /** "c8y-data-preparation" */
  readonly runtime: "c8y-data-preparation";

  // Additional fields will be added in future
}

declare function onMessage(msg: DeviceMessage, context: DataPrepContext): (CumulocityObject | DeviceMessage)[];
