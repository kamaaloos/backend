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

function paymentDateFilter(
  from?: Date,
  to?: Date,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = from;
  if (to) {
    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);
    filter.lte = end;
  }
  return filter;
}

const PAID_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
];

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

  /** Per-product sales from paid orders (tax-inclusive menu prices). */
  async productSales(
    opts: PeriodFilter & {
      skip?: number;
      take?: number;
      productName?: string;
      categoryName?: string;
    },
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: opts.restaurantId },
      select: { taxRatePercent: true, currency: true },
    });
    const taxRatePercent = Number(restaurant?.taxRatePercent ?? 22);
    const currency = restaurant?.currency ?? 'EUR';
    const dateFilter = paymentDateFilter(opts.from, opts.to);

    const orders = await this.prisma.order.findMany({
      where: {
        restaurantId: opts.restaurantId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        payments: {
          some: {
            status: { in: PAID_STATUSES },
            ...(dateFilter
              ? {
                  OR: [
                    { paidAt: dateFilter },
                    { paidAt: null, createdAt: dateFilter },
                  ],
                }
              : {}),
          },
        },
      },
      select: {
        id: true,
        payments: {
          where: { status: { in: PAID_STATUSES } },
          select: {
            id: true,
            paidAt: true,
            createdAt: true,
            receivedBy: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
          orderBy: { paidAt: 'asc' },
        },
        items: {
          select: {
            quantity: true,
            price: true,
            menuItem: {
              select: {
                name: true,
                category: { select: { name: true } },
              },
            },
            modifiers: { select: { priceDelta: true } },
          },
        },
      },
    });

    type Line = {
      productName: string;
      categoryName: string;
      quantity: number;
      taxRatePercent: number;
      netExTax: number;
      taxAmount: number;
      grossTotal: number;
      soldAt: string;
      orderId: string;
      paymentId: string;
      cashierName: string | null;
    };

    const lines: Line[] = [];

    for (const order of orders) {
      const paidPayments = order.payments
        .map((p) => ({
          ...p,
          at: p.paidAt ?? p.createdAt,
        }))
        .filter((p): p is typeof p & { at: Date } => p.at != null)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      const payment = paidPayments[0];
      if (!payment) continue;

      const cashierName = payment.receivedBy
        ? [payment.receivedBy.firstName, payment.receivedBy.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          payment.receivedBy.email
        : null;

      for (const item of order.items) {
        const modifierTotal = item.modifiers.reduce(
          (sum, m) => sum + Number(m.priceDelta),
          0,
        );
        const unitGross = Number(item.price) + modifierTotal;
        const gross = Number((unitGross * item.quantity).toFixed(2));
        const { netExTax, taxCollected } = taxFromInclusiveGross(
          gross,
          taxRatePercent,
        );
        lines.push({
          productName: item.menuItem.name,
          categoryName: item.menuItem.category.name,
          quantity: item.quantity,
          taxRatePercent,
          netExTax,
          taxAmount: taxCollected,
          grossTotal: gross,
          soldAt: payment.at.toISOString(),
          orderId: order.id,
          paymentId: payment.id,
          cashierName,
        });
      }
    }

    lines.sort(
      (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime(),
    );

    const byProductMap = new Map<
      string,
      {
        productName: string;
        categoryName: string;
        quantitySold: number;
        grossTotal: number;
        netExTax: number;
        taxAmount: number;
      }
    >();

    for (const line of lines) {
      const key = `${line.categoryName}\0${line.productName}`;
      const row = byProductMap.get(key) ?? {
        productName: line.productName,
        categoryName: line.categoryName,
        quantitySold: 0,
        grossTotal: 0,
        netExTax: 0,
        taxAmount: 0,
      };
      row.quantitySold += line.quantity;
      row.grossTotal = Number((row.grossTotal + line.grossTotal).toFixed(2));
      row.netExTax = Number((row.netExTax + line.netExTax).toFixed(2));
      row.taxAmount = Number((row.taxAmount + line.taxAmount).toFixed(2));
      byProductMap.set(key, row);
    }

    const byProduct = [...byProductMap.values()].sort(
      (a, b) => b.grossTotal - a.grossTotal,
    );

    const productFilter = opts.productName?.trim();
    const categoryFilter = opts.categoryName?.trim();
    const detailLines =
      productFilter || categoryFilter
        ? lines.filter((line) => {
            if (productFilter && line.productName !== productFilter) {
              return false;
            }
            if (categoryFilter && line.categoryName !== categoryFilter) {
              return false;
            }
            return true;
          })
        : lines;

    const summary = detailLines.reduce(
      (acc, line) => {
        acc.quantitySold += line.quantity;
        acc.lineCount += 1;
        acc.grossTotal = Number((acc.grossTotal + line.grossTotal).toFixed(2));
        acc.netExTax = Number((acc.netExTax + line.netExTax).toFixed(2));
        acc.taxAmount = Number((acc.taxAmount + line.taxAmount).toFixed(2));
        return acc;
      },
      {
        quantitySold: 0,
        lineCount: 0,
        grossTotal: 0,
        netExTax: 0,
        taxAmount: 0,
      },
    );

    const linesTotal = detailLines.length;
    const skip = Math.max(0, opts.skip ?? 0);
    const take = opts.take;
    const pagedLines =
      take != null ? detailLines.slice(skip, skip + take) : detailLines;

    return {
      currency,
      taxRatePercent,
      lines: pagedLines,
      linesTotal,
      summary,
      byProduct,
      filter: {
        productName: productFilter || null,
        categoryName: categoryFilter || null,
      },
    };
  }
}
