/** Socket.IO event names — versioned so clients can migrate safely. */
export const RealtimeEvents = {
  CONNECTED: 'v1.realtime.connected',
  ERROR: 'v1.realtime.error',
  ORDER_CREATED: 'v1.order.created',
  ORDER_STATUS_CHANGED: 'v1.order.status.changed',
  ORDER_CANCELLED: 'v1.order.cancelled',
  PAYMENT_UPDATED: 'v1.payment.updated',
  KITCHEN_TICKET: 'v1.kitchen.ticket',
  CUSTOMER_ORDER: 'v1.customer.order',
  PICKUP_BOARD: 'v1.pickup.board',
  SERVICE_REQUEST_CREATED: 'v1.service-request.created',
  SERVICE_REQUEST_UPDATED: 'v1.service-request.updated',
} as const;

export type RealtimeEventName =
  (typeof RealtimeEvents)[keyof typeof RealtimeEvents];
