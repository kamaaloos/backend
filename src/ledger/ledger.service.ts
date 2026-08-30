import { Injectable } from '@nestjs/common';
import {
  LedgerCategory,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

interface RecordPaymentParams {
  paymentId: string;
  restaurantId: string;
  branchId: string;
  amount: number;
  tipAmount: number;
  date?: Date;
}

interface RecordRefundParams {
  paymentId: string;
  restaurantId: string;
  branchId: string;
  amount: number;
  date?: Date;
}

type PeriodFilter = {
  restaurantId: string;
  branchId?: string;
  from?: Date;
  to?: Date;
};

function journalWhere(opts: PeriodFilter): Prisma.JournalEntryWhereInput {
  const where: Prisma.JournalEntryWhereInput = {
    restaurantId: opts.restaurantId,
  };
  if (opts.branchId) where.branchId = opts.branchId;
  if (opts.from || opts.to) {
    where.date = {};
    if (opts.from) where.date.gte = opts.from;
    if (opts.to) where.date.lte = opts.to;
  }
  return where;
}

/** Tax-inclusive VAT split (same formula as cashier receipts). */
function taxFromInclusiveGross(gross: number, taxRatePercent: number) {
  const rate = Math.max(0, taxRatePercent) / 100;
  if (rate <= 0 || gross <= 0) {
    return { netExTax: Number(gross.toFixed(2)), taxCollected: 0 };
  }
  const netExTax = Number((gross / (1 + rate)).toFixed(2));
  const taxCollected = Number((gross - netExTax).toFixed(2));
  return { netExTax, taxCollected };
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async recordPayment(params: RecordPaymentParams) {
    const { paymentId, restaurantId, branchId, amount, tipAmount, date } =
      params;
    const revenue = amount - tipAmount;
    const now = date ?? new Date();

    const entries: Prisma.JournalEntryCreateManyInput[] = [];

    if (revenue > 0) {
      entries.push({
        restaurantId,
        branchId,
        date: now,
        category: LedgerCategory.REVENUE,
        description: 'Payment received',
        debit: revenue,
        credit: 0,
        paymentId,
      });
    }

    if (tipAmount > 0) {
      entries.push({
        restaurantId,
        branchId,
        date: now,
        category: LedgerCategory.TIPS,
        description: 'Tip received',
        debit: tipAmount,
        credit: 0,
        paymentId,
      });
    }

    if (entries.length > 0) {
      await this.prisma.journalEntry.createMany({ data: entries });
    }
  }

  async recordRefund(params: RecordRefundParams) {
    const { paymentId, restaurantId, branchId, amount, date } = params;

    await this.prisma.journalEntry.create({
      data: {
        restaurantId,
        branchId,
        date: date ?? new Date(),
        category: LedgerCategory.REFUND,
        description: 'Refund issued',
        debit: 0,
        credit: amount,
        paymentId,
      },
    });
  }

  async findEntries(opts: PeriodFilter & { skip?: number; take?: number }) {
    const where = journalWhere(opts);

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: opts.skip ?? 0,
        take: opts.take ?? 50,
        include: {
          payment: {
            select: {
              method: true,
              channel: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { entries, total };
  }

  async summary(opts: PeriodFilter) {
    const where = journalWhere(opts);

    const [groups, restaurant, salesByChannel] = await Promise.all([
      this.prisma.journalEntry.groupBy({
        by: ['category'],
        where,
        _sum: { debit: true, credit: true },
      }),
      this.prisma.restaurant.findUnique({
        where: { id: opts.restaurantId },
        select: { taxRatePercent: true, currency: true },
      }),
      this.salesByChannel(opts),
    ]);

    const categories = groups.map((g) => ({
      category: g.category,
      totalDebit: Number(g._sum.debit ?? 0),
      totalCredit: Number(g._sum.credit ?? 0),
    }));

    const byCat = (cat: LedgerCategory) =>
      categories.find((c) => c.category === cat);

    const revenue = byCat(LedgerCategory.REVENUE)?.totalDebit ?? 0;
    const tips = byCat(LedgerCategory.TIPS)?.totalDebit ?? 0;
    const refunds = byCat(LedgerCategory.REFUND)?.totalCredit ?? 0;
    const netSales = Number((revenue - refunds).toFixed(2));
    const taxRatePercent = Number(restaurant?.taxRatePercent ?? 22);
    const { netExTax, taxCollected } = taxFromInclusiveGross(
      Math.max(0, netSales),
      taxRatePercent,
    );

    return {
      categories,
      totals: {
        revenue,
        tips,
        refunds,
        netSales,
        taxRatePercent,
        taxCollected,
        netExTax,
        currency: restaurant?.currency ?? 'EUR',
      },
      salesByChannel,
    };
  }

  async salesByChannel(opts: PeriodFilter) {
    const dateFilter: Prisma.DateTimeFilter | undefined =
      opts.from || opts.to
        ? {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {}),
          }
        : undefined;

    const payments = await this.prisma.payment.findMany({
      where: {
        status: {
          in: [
            PaymentStatus.PAID,
            PaymentStatus.PARTIALLY_REFUNDED,
            PaymentStatus.REFUNDED,
          ],
        },
        order: {
          restaurantId: opts.restaurantId,
          ...(opts.branchId ? { branchId: opts.branchId } : {}),
        },
        ...(dateFilter
          ? {
              OR: [
                { paidAt: dateFilter },
                { paidAt: null, createdAt: dateFilter },
              ],
            }
          : {}),
      },
      select: {
        channel: true,
        amount: true,
        tipAmount: true,
        refundedAmount: true,
      },
    });

    const map = new Map<
      string,
      { channel: string; amount: number; tipAmount: number; count: number }
    >();

    for (const p of payments) {
      const channel = p.channel;
      const tip = Number(p.tipAmount ?? 0);
      const refunded = Number(p.refundedAmount ?? 0);
      const gross = Math.max(0, Number(p.amount) - refunded);
      const tipNet = Math.min(tip, gross);
      const cover = Number((gross - tipNet).toFixed(2));
      const row = map.get(channel) ?? {
        channel,
        amount: 0,
        tipAmount: 0,
        count: 0,
      };
      row.amount = Number((row.amount + cover).toFixed(2));
      row.tipAmount = Number((row.tipAmount + tipNet).toFixed(2));
      row.count += 1;
      map.set(channel, row);
    }

    return [...map.values()].sort((a, b) => a.channel.localeCompare(b.channel));
  }
}
