-- Device token expiry
ALTER TABLE "Device" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);

-- Order status timestamps for kitchen SLA
ALTER TABLE "Order" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "preparingAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "readyAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "servedAt" TIMESTAMP(3);
