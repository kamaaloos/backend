-- Backfill (separate migration: new enum values cannot be used in the same TX as ADD VALUE).
UPDATE "Payment"
SET
  "method" = 'CARD_MANUAL',
  "channel" = 'COUNTER'
WHERE "method" = 'CARD'
  AND ("provider" IS NULL OR "provider" <> 'stripe');

UPDATE "Payment"
SET "channel" = 'TERMINAL'
WHERE "method" = 'CARD'
  AND "provider" = 'stripe';
