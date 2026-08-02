-- AlterEnum: walk-in orders wait for prepay before kitchen.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
