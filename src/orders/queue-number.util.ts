import { Prisma } from '@prisma/client';

/** Start of the current UTC day — queue numbers reset daily per branch. */
export function queueDayStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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
