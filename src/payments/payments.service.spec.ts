/// <reference types="jest" />
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PaymentProviderService } from './payment-provider';

describe('PaymentsService status machine', () => {
  const authorization = {
    canAccessBranch: jest.fn().mockResolvedValue(undefined),
  };
  const realtime = {
    publishPaymentUpdated: jest.fn(),
    publishOrderStatusChanged: jest.fn(),
  };
  const paymentProvider = {
    isOnlineEnabled: jest.fn().mockReturnValue(false),
    initialStatusFor: jest.fn(
      (_method: string, requested?: PaymentStatus) =>
        requested ?? PaymentStatus.PAID,
    ),
    getProviderId: jest.fn().mockReturnValue('none'),
    createOnlineCheckout: jest.fn(),
    refundOnline: jest.fn().mockResolvedValue(undefined),
    cashierAppUrl: jest.fn().mockReturnValue('http://localhost:3005'),
    customerAppUrl: jest.fn().mockReturnValue('http://localhost:3001'),
    getPublicConfig: jest.fn().mockReturnValue({
      provider: 'none',
      onlineEnabled: false,
      publishableKey: null,
    }),
  };

  function buildService(prisma: Record<string, unknown>) {
    return new PaymentsService(
      prisma as never,
      authorization as never,
      realtime as never,
      paymentProvider as unknown as PaymentProviderService,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    paymentProvider.isOnlineEnabled.mockReturnValue(false);
    paymentProvider.initialStatusFor.mockImplementation(
      (_method: string, requested?: PaymentStatus) =>
        requested ?? PaymentStatus.PAID,
    );
  });

  it('records PAID without completing a NEW order', async () => {
    const orderUpdate = jest.fn();
    const paymentCreate = jest.fn().mockResolvedValue({
      id: 'pay-1',
      orderId: 'ord-1',
      amount: 20,
      tipAmount: 0,
      method: PaymentMethod.CASH,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    });

    const prisma = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ord-1',
            branchId: 'br-1',
            restaurantId: 'r-1',
            tableId: 't-1',
            status: OrderStatus.NEW,
            mode: 'DINE_IN',
            total: 20,
            payments: [], items: [],
            restaurant: { currency: 'USD' },
          })
          .mockResolvedValue(null),
      },
      payment: {},
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          payment: { create: paymentCreate },
          order: { update: orderUpdate, count: jest.fn() },
          table: { update: jest.fn() },
        }),
      ),
    };

    const service = buildService(prisma);
    const result = await service.create(
      {
        sub: 'u1',
        id: 'u1',
        email: 'c@x',
        role: 'CASHIER' as never,
        restaurantId: 'r-1',
        branchId: 'br-1',
      },
      { orderId: 'ord-1', method: PaymentMethod.CASH, status: PaymentStatus.PAID },
    );

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(realtime.publishOrderStatusChanged).not.toHaveBeenCalled();
    expect(realtime.publishPaymentUpdated).toHaveBeenCalled();
  });

  it('completes a SERVED order when payment is PAID', async () => {
    const orderUpdate = jest.fn().mockResolvedValue({});
    const tableUpdate = jest.fn().mockResolvedValue({});
    const orderCount = jest.fn().mockResolvedValue(0);
    const paymentCreate = jest.fn().mockResolvedValue({
      id: 'pay-2',
      orderId: 'ord-2',
      amount: 30,
      tipAmount: 0,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    });

    const prisma = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ord-2',
            branchId: 'br-1',
            restaurantId: 'r-1',
            tableId: 't-1',
            status: OrderStatus.SERVED,
            mode: 'DINE_IN',
            total: 30,
            payments: [], items: [],
            restaurant: { currency: 'USD' },
          })
          .mockResolvedValueOnce({
            id: 'ord-2',
            branchId: 'br-1',
            restaurantId: 'r-1',
            tableId: 't-1',
            status: OrderStatus.COMPLETED,
            table: null,
            items: [],
            restaurant: { currency: 'USD' },
          }),
      },
      payment: {},
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          payment: { create: paymentCreate },
          order: { update: orderUpdate, count: orderCount },
          table: { update: tableUpdate },
        }),
      ),
    };

    const service = buildService(prisma);
    await service.create(
      {
        sub: 'u1',
        id: 'u1',
        email: 'c@x',
        role: 'CASHIER' as never,
        restaurantId: 'r-1',
        branchId: 'br-1',
      },
      { orderId: 'ord-2', method: PaymentMethod.CARD, status: PaymentStatus.PAID },
    );

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.COMPLETED }),
      }),
    );
    expect(realtime.publishOrderStatusChanged).toHaveBeenCalled();
  });

  it('completes a READY walk-in order when payment is PAID', async () => {
    const orderUpdate = jest.fn().mockResolvedValue({});
    const paymentCreate = jest.fn().mockResolvedValue({
      id: 'pay-3',
      orderId: 'ord-3',
      amount: 12,
      tipAmount: 0,
      method: PaymentMethod.CASH,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    });

    const prisma = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ord-3',
            branchId: 'br-1',
            restaurantId: 'r-1',
            tableId: null,
            status: OrderStatus.READY,
            mode: 'WALK_IN',
            total: 12,
            payments: [], items: [],
            restaurant: { currency: 'USD' },
          })
          .mockResolvedValueOnce({
            id: 'ord-3',
            branchId: 'br-1',
            restaurantId: 'r-1',
            tableId: null,
            status: OrderStatus.COMPLETED,
            mode: 'WALK_IN',
            table: null,
            items: [],
            restaurant: { currency: 'USD' },
          }),
      },
      payment: {},
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          payment: { create: paymentCreate },
          order: { update: orderUpdate, count: jest.fn() },
          table: { update: jest.fn() },
        }),
      ),
    };

    const service = buildService(prisma);
    await service.create(
      {
        sub: 'u1',
        id: 'u1',
        email: 'c@x',
        role: 'CASHIER' as never,
        restaurantId: 'r-1',
        branchId: 'br-1',
      },
      { orderId: 'ord-3', method: PaymentMethod.CASH, status: PaymentStatus.PAID },
    );

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.COMPLETED }),
      }),
    );
    expect(realtime.publishOrderStatusChanged).toHaveBeenCalled();
  });

  it('rejects amount that does not match order total + tip', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-4',
          branchId: 'br-1',
          restaurantId: 'r-1',
          tableId: 't-1',
          status: OrderStatus.SERVED,
          mode: 'DINE_IN',
          total: 20,
          payments: [], items: [],
          restaurant: { currency: 'EUR' },
        }),
      },
      payment: {},
      $transaction: jest.fn(),
    };

    const service = buildService(prisma);
    await expect(
      service.create(
        {
          sub: 'u1',
          id: 'u1',
          email: 'c@x',
          role: 'CASHIER' as never,
          restaurantId: 'r-1',
          branchId: 'br-1',
        },
        {
          orderId: 'ord-4',
          method: PaymentMethod.CASH,
          status: PaymentStatus.PAID,
          amount: 25,
        },
      ),
    ).rejects.toThrow('Payment exceeds remaining balance');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts tipAmount and charges order total + tip', async () => {
    const paymentCreate = jest.fn().mockResolvedValue({
      id: 'pay-tip',
      orderId: 'ord-5',
      amount: 25,
      tipAmount: 5,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    });

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-5',
          branchId: 'br-1',
          restaurantId: 'r-1',
          tableId: 't-1',
          status: OrderStatus.NEW,
          mode: 'DINE_IN',
          total: 20,
          payments: [], items: [],
          restaurant: { currency: 'EUR' },
        }),
      },
      payment: {},
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          payment: { create: paymentCreate },
          order: { update: jest.fn(), count: jest.fn() },
          table: { update: jest.fn() },
        }),
      ),
    };

    const service = buildService(prisma);
    await service.create(
      {
        sub: 'u1',
        id: 'u1',
        email: 'c@x',
        role: 'CASHIER' as never,
        restaurantId: 'r-1',
        branchId: 'br-1',
      },
      {
        orderId: 'ord-5',
        method: PaymentMethod.CARD,
        tipAmount: 5,
        status: PaymentStatus.PAID,
      },
    );

    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 25, tipAmount: 5 }),
      }),
    );
  });

  it('rejects ONLINE when provider is disabled', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-6',
          branchId: 'br-1',
          restaurantId: 'r-1',
          tableId: 't-1',
          status: OrderStatus.NEW,
          mode: 'DINE_IN',
          total: 10,
          payments: [], items: [],
          restaurant: { currency: 'EUR' },
        }),
      },
      $transaction: jest.fn(),
    };

    const service = buildService(prisma);
    await expect(
      service.create(
        {
          sub: 'u1',
          id: 'u1',
          email: 'c@x',
          role: 'CASHIER' as never,
          restaurantId: 'r-1',
          branchId: 'br-1',
        },
        { orderId: 'ord-6', method: PaymentMethod.ONLINE },
      ),
    ).rejects.toThrow('ONLINE payments require PAYMENT_PROVIDER');
  });

  it('creates ONLINE checkout when provider is mock', async () => {
    paymentProvider.isOnlineEnabled.mockReturnValue(true);
    paymentProvider.getProviderId.mockReturnValue('mock');
    paymentProvider.initialStatusFor.mockReturnValue(PaymentStatus.PENDING);
    paymentProvider.createOnlineCheckout.mockResolvedValue({
      provider: 'mock',
      providerRef: 'mock_pay-online',
    });

    const paymentCreate = jest.fn().mockResolvedValue({
      id: 'pay-online',
      orderId: 'ord-online',
      amount: 20,
      tipAmount: 0,
      method: PaymentMethod.ONLINE,
      status: PaymentStatus.PENDING,
      provider: 'mock',
    });
    const paymentUpdate = jest.fn().mockResolvedValue({
      id: 'pay-online',
      orderId: 'ord-online',
      amount: 20,
      tipAmount: 0,
      method: PaymentMethod.ONLINE,
      status: PaymentStatus.PENDING,
      provider: 'mock',
      providerRef: 'mock_pay-online',
    });

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-online',
          branchId: 'br-1',
          restaurantId: 'r-1',
          tableId: 't-1',
          status: OrderStatus.NEW,
          mode: 'DINE_IN',
          total: 20,
          payments: [], items: [],
          restaurant: { currency: 'EUR' },
        }),
      },
      payment: { update: paymentUpdate },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          payment: { create: paymentCreate },
          order: { update: jest.fn(), count: jest.fn() },
          table: { update: jest.fn() },
        }),
      ),
    };

    const service = buildService(prisma);
    const result = await service.create(
      {
        sub: 'u1',
        id: 'u1',
        email: 'c@x',
        role: 'CASHIER' as never,
        restaurantId: 'r-1',
        branchId: 'br-1',
      },
      { orderId: 'ord-online', method: PaymentMethod.ONLINE },
    );

    expect(paymentProvider.createOnlineCheckout).toHaveBeenCalled();
    expect(result.providerRef).toBe('mock_pay-online');
    expect(result.status).toBe(PaymentStatus.PENDING);
  });

  it('fully refunds a PAID payment', async () => {
    const paymentUpdate = jest.fn().mockResolvedValue({
      id: 'pay-r1',
      orderId: 'ord-r1',
      amount: 20,
      tipAmount: 0,
      refundedAmount: 20,
      method: PaymentMethod.CARD,
      status: PaymentStatus.REFUNDED,
      refundedAt: new Date(),
    });

    const prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pay-r1',
          orderId: 'ord-r1',
          amount: 20,
          tipAmount: 0,
          refundedAmount: 0,
          status: PaymentStatus.PAID,
          order: {
            branchId: 'br-1',
            restaurantId: 'r-1',
            status: OrderStatus.COMPLETED,
            restaurant: { currency: 'EUR' },
          },
        }),
        update: paymentUpdate,
      },
    };

    const service = buildService(prisma);
    await service.refund(
      'pay-r1',
      {
        sub: 'u1',
        id: 'u1',
        email: 'c@x',
        role: 'CASHIER' as never,
        restaurantId: 'r-1',
        branchId: 'br-1',
      },
      {},
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refundedAmount: 20,
          status: PaymentStatus.REFUNDED,
        }),
      }),
    );
    expect(realtime.publishPaymentUpdated).toHaveBeenCalled();
  });

  it('partially refunds and rejects over-refund', async () => {
    const paymentUpdate = jest.fn().mockResolvedValue({
      id: 'pay-r2',
      amount: 30,
      refundedAmount: 10,
      status: PaymentStatus.PARTIALLY_REFUNDED,
    });

    const prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pay-r2',
          orderId: 'ord-r2',
          amount: 30,
          tipAmount: 0,
          refundedAmount: 0,
          status: PaymentStatus.PAID,
          order: {
            branchId: 'br-1',
            restaurantId: 'r-1',
            status: OrderStatus.COMPLETED,
            restaurant: { currency: 'EUR' },
          },
        }),
        update: paymentUpdate,
      },
    };

    const service = buildService(prisma);
    const user = {
      sub: 'u1',
      id: 'u1',
      email: 'c@x',
      role: 'CASHIER' as never,
      restaurantId: 'r-1',
      branchId: 'br-1',
    };

    await service.refund('pay-r2', user, { amount: 10 });
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refundedAmount: 10,
          status: PaymentStatus.PARTIALLY_REFUNDED,
        }),
      }),
    );

    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-r2',
      orderId: 'ord-r2',
      amount: 30,
      tipAmount: 0,
      refundedAmount: 10,
      status: PaymentStatus.PARTIALLY_REFUNDED,
      order: {
        branchId: 'br-1',
        restaurantId: 'r-1',
        status: OrderStatus.COMPLETED,
        restaurant: { currency: 'EUR' },
      },
    });

    await expect(
      service.refund('pay-r2', user, { amount: 25 }),
    ).rejects.toThrow('Refund exceeds remaining balance');
  });
});
