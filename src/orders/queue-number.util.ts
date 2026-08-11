import { Prisma } from '@prisma/client';

/** Walk-in pickup code prefix: W0012 + 2-digit daily queue (guest 1 → W001201). */
export const WALK_IN_QUEUE_PREFIX = 'W0012';

/** Start of the current UTC day — queue numbers reset daily per branch. */
export function queueDayStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Human-facing walk-in code from the daily sequence (stored as Int).
 * Guest 1 → W001201, guest 12 → W001212.
 */
export function formatWalkInQueueCode(
  queueNumber: number | null | undefined,
): string | null {
  if (queueNumber == null || !Number.isFinite(queueNumber) || queueNumber < 1) {
    return null;
  }
  return `${WALK_IN_QUEUE_PREFIX}${String(Math.trunc(queueNumber)).padStart(2, '0')}`;
}

/**
 * Next walk-in queue number for a branch (1-based, resets each UTC day).
 * Must be called inside a transaction that also creates the order.
 */
export async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  now = new Date(),
): Promise<number> {
  const dayStart = queueDayStart(now);
  const last = await tx.order.aggregate({
    where: {
      branchId,
      queueNumber: { not: null },
      createdAt: { gte: dayStart },
    },
    _max: { queueNumber: true },
  });

  return (last._max.queueNumber ?? 0) + 1;
}
