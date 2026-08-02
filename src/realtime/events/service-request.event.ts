export type ServiceRequestEvent = {
  requestId: string;
  restaurantId: string;
  branchId: string;
  tableId: string;
  tableNumber: string;
  orderId: string | null;
  type: string;
  status: string;
  note: string | null;
  createdAt: string;
};
