export const REALTIME_EVENT_VERSION = 1 as const;

export type RealtimeEnvelope<T> = {
  eventId: string;
  occurredAt: string;
  version: typeof REALTIME_EVENT_VERSION;
  /** Monotonic per restaurant+branch — clients can drop older packets after reconnect. */
  sequence: number;
  type: string;
  data: T;
};
