-- One-time device pairing codes (short-lived QR exchange).
ALTER TABLE "Device" ADD COLUMN "pairingCode" TEXT;
ALTER TABLE "Device" ADD COLUMN "pairingCodeExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Device_pairingCode_key" ON "Device"("pairingCode");
