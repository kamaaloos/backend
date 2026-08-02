import { nextQueueNumber, queueDayStart } from './queue-number.util';

describe('queue-number.util', () => {
  it('starts queue day at UTC midnight', () => {
    const now = new Date('2026-07-30T15:22:00.000Z');
    expect(queueDayStart(now).toISOString()).toBe('2026-07-30T00:00:00.000Z');
  });

  it('assigns 1 when no orders exist today', async () => {
    const tx = {
      order: {
        aggregate: jest.fn().mockResolvedValue({ _max: { queueNumber: null } }),
      },
    };

    await expect(nextQueueNumber(tx as never, 'branch-1')).resolves.toBe(1);
  });

  it('increments from the max queue number for the branch day', async () => {
    const tx = {
      order: {
        aggregate: jest.fn().mockResolvedValue({ _max: { queueNumber: 41 } }),
      },
    };

    await expect(nextQueueNumber(tx as never, 'branch-1')).resolves.toBe(42);
    expect(tx.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: 'branch-1',
          queueNumber: { not: null },
        }),
      }),
    );
  });
});
