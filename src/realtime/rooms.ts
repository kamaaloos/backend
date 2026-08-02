export type RealtimeRoomKind =
  | 'kitchen'
  | 'waiter'
  | 'cashier'
  | 'customer'
  | 'pickup';

export function restaurantRoom(restaurantId: string): string {
  return `restaurant:${restaurantId}`;
}

export function branchRoom(restaurantId: string, branchId: string): string {
  return `restaurant:${restaurantId}:branch:${branchId}`;
}

export function roleRoom(
  restaurantId: string,
  branchId: string,
  kind: RealtimeRoomKind,
): string {
  return `restaurant:${restaurantId}:branch:${branchId}:${kind}`;
}

/** Private guest room — one table only (not shared with other tables). */
export function tableRoom(
  restaurantId: string,
  branchId: string,
  tableId: string,
): string {
  return `restaurant:${restaurantId}:branch:${branchId}:table:${tableId}`;
}

/** Leave any namespaced realtime rooms (not the socket's own id room). */
export function isRealtimeRoom(room: string): boolean {
  return room.startsWith('restaurant:');
}
