import { Injectable } from '@nestjs/common';
import { LedgerCategory, Prisma } from '@prisma/client';

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

  async findEntries(opts: {
    restaurantId: string;
    branchId?: string;
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.JournalEntryWhereInput = {
      restaurantId: opts.restaurantId,
    };
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = opts.from;
      if (opts.to) where.date.lte = opts.to;
    }

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: opts.skip ?? 0,
        take: opts.take ?? 50,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { entries, total };
  }

  async summary(opts: {
    restaurantId: string;
    branchId?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.JournalEntryWhereInput = {
      restaurantId: opts.restaurantId,
    };
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = opts.from;
      if (opts.to) where.date.lte = opts.to;
    }

    const groups = await this.prisma.journalEntry.groupBy({
      by: ['category'],
      where,
      _sum: { debit: true, credit: true },
    });

    return groups.map((g) => ({
      category: g.category,
      totalDebit: Number(g._sum.debit ?? 0),
      totalCredit: Number(g._sum.credit ?? 0),
    }));
  }
}
