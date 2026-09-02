/**
 * Seeds ~1000 paid orders (+ journal entries) for a calendar year so Ledger and
 * Product sales reports can be reviewed for tax / finance use.
 *
 * Usage:
 *   node --import tsx scripts/seed-finance-demo.ts
 *   node --import tsx scripts/seed-finance-demo.ts --restaurant=al-huda --count=1000 --year=2025
 *   node --import tsx scripts/seed-finance-demo.ts --force   # replace existing demo rows
 */
import {
  LedgerCategory,
  OrderMode,
  OrderStatus,
  PaymentChannel,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_TAG = 'FINANCE_DEMO';
const BATCH_SIZE = 25;

type Args = {
  restaurant?: string;
  count: number;
  year: number;
  force: boolean;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let restaurant: string | undefined;
  let count = 1000;
  let year = new Date().getFullYear() - 1;
  let force = false;

  for (const arg of args) {
    if (arg === '--force') force = true;
    else if (arg.startsWith('--restaurant=')) restaurant = arg.slice('--restaurant='.length);
    else if (arg.startsWith('--count=')) count = Math.max(1, Number(arg.slice('--count='.length)) || 1000);
    else if (arg.startsWith('--year=')) year = Number(arg.slice('--year='.length)) || year;
  }

  return { restaurant, count, year, force };
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

/** Weight toward lunch (11–14) and dinner (17–21) on busier weekend days. */
function randomSaleMoment(year: number): Date {
  const month = randomInt(0, 11);
  const day = randomInt(1, 28);
  const date = new Date(year, month, day);
  const weekday = date.getDay();
  const isWeekend = weekday === 0 || weekday === 6;

  const slotRoll = Math.random();
  let hour: number;
  if (slotRoll < 0.45) hour = randomInt(11, 14);
  else if (slotRoll < 0.85) hour = randomInt(17, 21);
  else hour = randomInt(8, 22);

  if (isWeekend && Math.random() < 0.15) hour = randomInt(19, 22);

  const minute = randomInt(0, 59);
  const second = randomInt(0, 59);
  return new Date(year, month, day, hour, minute, second);
}

function round2(n: number) {
  return Number(n.toFixed(2));
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

async function resolveRestaurant(query?: string) {
  if (query) {
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        active: true,
        OR: [
          { slug: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
    });
    if (restaurant) return restaurant;
    throw new Error(`No active restaurant matching "${query}".`);
  }

  const restaurant = await prisma.restaurant.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!restaurant) throw new Error('No active restaurant found.');
  return restaurant;
}

async function clearFinanceDemo(restaurantId: string) {
  const orders = await prisma.order.findMany({
    where: { restaurantId, customerName: DEMO_TAG },
    select: { id: true, payments: { select: { id: true } } },
  });
  if (orders.length === 0) return 0;

  const paymentIds = orders.flatMap((o) => o.payments.map((p) => p.id));
  const orderIds = orders.map((o) => o.id);

  await prisma.journalEntry.deleteMany({
    where: { paymentId: { in: paymentIds } },
  });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  return orders.length;
}

async function ensureMenuItems(restaurantId: string, categoryId: string) {
  const existing = await prisma.menuItem.findMany({
    where: { restaurantId, active: true },
    select: { id: true, name: true, price: true },
  });
  if (existing.length >= 5) return existing;

  const extras: Prisma.MenuItemCreateManyInput[] = [
    { restaurantId, categoryId, name: 'Tea', price: 2, active: true },
    { restaurantId, categoryId, name: 'Espresso', price: 3.5, active: true },
    { restaurantId, categoryId, name: 'Caesar Salad', price: 9.5, active: true },
    { restaurantId, categoryId, name: 'Margherita Pizza', price: 12.5, active: true },
    { restaurantId, categoryId, name: 'Grilled Fish', price: 18, active: true },
    { restaurantId, categoryId, name: 'Tiramisu', price: 7.5, active: true },
    { restaurantId, categoryId, name: 'Cola', price: 3, active: true },
    { restaurantId, categoryId, name: 'Lamb Suqaar', price: 16, active: true },
  ];

  await prisma.menuItem.createMany({
    data: extras.filter(
      (item) => !existing.some((e) => e.name.toLowerCase() === item.name!.toLowerCase()),
    ),
    skipDuplicates: true,
  });

  return prisma.menuItem.findMany({
    where: { restaurantId, active: true },
    select: { id: true, name: true, price: true },
  });
}

type MenuRow = { id: string; name: string; price: Prisma.Decimal };

async function createTransaction(params: {
  restaurantId: string;
  branchId: string;
  cashierId: string | null;
  menuItems: MenuRow[];
  paidAt: Date;
  index: number;
}) {
  const { restaurantId, branchId, cashierId, menuItems, paidAt, index } = params;

  const lineCount = randomInt(1, 4);
  const chosen = new Set<string>();
  const lines: Array<{ menuItemId: string; quantity: number; price: number }> = [];

  while (lines.length < lineCount) {
    const item = pick(menuItems);
    if (chosen.has(item.id) && Math.random() < 0.6) continue;
    chosen.add(item.id);
    lines.push({
      menuItemId: item.id,
      quantity: randomInt(1, 3),
      price: Number(item.price),
    });
  }

  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
  );

  const channelRoll = Math.random();
  const channel: PaymentChannel =
    channelRoll < 0.55
      ? PaymentChannel.CASH
      : channelRoll < 0.85
        ? PaymentChannel.COUNTER
        : PaymentChannel.TERMINAL;

  const method: PaymentMethod =
    channel === PaymentChannel.CASH
      ? PaymentMethod.CASH
      : channel === PaymentChannel.COUNTER
        ? PaymentMethod.CARD_MANUAL
        : PaymentMethod.CARD;

  const tipAmount =
    Math.random() < 0.12 ? round2(randomBetween(0.5, 4)) : 0;
  const amount = round2(subtotal + tipAmount);
  const revenue = round2(amount - tipAmount);

  const acceptedAt = new Date(paidAt.getTime() - randomInt(8, 25) * 60_000);
  const preparingAt = new Date(acceptedAt.getTime() + randomInt(2, 8) * 60_000);
  const readyAt = new Date(preparingAt.getTime() + randomInt(10, 35) * 60_000);
  const servedAt = new Date(readyAt.getTime() + randomInt(3, 15) * 60_000);

  const partialRefund =
    Math.random() < 0.025
      ? round2(revenue * randomBetween(0.15, 0.5))
      : 0;

  const paymentStatus: PaymentStatus =
    partialRefund > 0 ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.PAID;

  const order = await prisma.order.create({
    data: {
      restaurantId,
      branchId,
      mode: Math.random() < 0.35 ? OrderMode.DINE_IN : OrderMode.WALK_IN,
      queueNumber: randomInt(1, 120),
      customerName: DEMO_TAG,
      status: OrderStatus.COMPLETED,
      total: subtotal,
      acceptedAt,
      preparingAt,
      readyAt,
      servedAt,
      createdAt: acceptedAt,
      updatedAt: servedAt,
      items: {
        create: lines.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          price: line.price,
          status: OrderStatus.COMPLETED,
          firedAt: preparingAt,
          createdAt: preparingAt,
        })),
      },
      payments: {
        create: {
          amount,
          tipAmount,
          refundedAmount: partialRefund,
          method,
          channel,
          status: paymentStatus,
          paidAt,
          createdAt: paidAt,
          updatedAt: paidAt,
          receivedByUserId: cashierId,
          provider: 'mock',
        },
      },
    },
    include: { payments: true },
  });

  const payment = order.payments[0]!;

  const journalRows: Prisma.JournalEntryCreateManyInput[] = [];
  if (revenue > 0) {
    journalRows.push({
      restaurantId,
      branchId,
      date: paidAt,
      category: LedgerCategory.REVENUE,
      description: `Payment received (#${index + 1})`,
      debit: revenue,
      credit: 0,
      paymentId: payment.id,
      createdAt: paidAt,
    });
  }
  if (tipAmount > 0) {
    journalRows.push({
      restaurantId,
      branchId,
      date: paidAt,
      category: LedgerCategory.TIPS,
      description: `Tip received (#${index + 1})`,
      debit: tipAmount,
      credit: 0,
      paymentId: payment.id,
      createdAt: paidAt,
    });
  }
  if (partialRefund > 0) {
    journalRows.push({
      restaurantId,
      branchId,
      date: new Date(paidAt.getTime() + randomInt(1, 72) * 3_600_000),
      category: LedgerCategory.REFUND,
      description: `Refund issued (#${index + 1})`,
      debit: 0,
      credit: partialRefund,
      paymentId: payment.id,
    });
  }

  if (journalRows.length > 0) {
    await prisma.journalEntry.createMany({ data: journalRows });
  }
}

async function main() {
  const { restaurant: restaurantQuery, count, year, force } = parseArgs();
  const restaurant = await resolveRestaurant(restaurantQuery);

  const existing = await prisma.order.count({
    where: { restaurantId: restaurant.id, customerName: DEMO_TAG },
  });

  if (existing > 0 && !force) {
    console.log(
      `ℹ️  ${existing} finance-demo orders already exist for "${restaurant.name}".`,
    );
    console.log('   Re-run with --force to replace them.');
    return;
  }

  if (existing > 0 && force) {
    const removed = await clearFinanceDemo(restaurant.id);
    console.log(`🗑️  Removed ${removed} previous finance-demo orders.`);
  }

  let branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, active: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Main',
        active: true,
      },
    });
  }

  let category = await prisma.menuCategory.findFirst({
    where: { restaurantId: restaurant.id, active: true },
    orderBy: { displayOrder: 'asc' },
  });
  if (!category) {
    category = await prisma.menuCategory.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Menu',
        displayOrder: 1,
        active: true,
      },
    });
  }

  const menuItems = await ensureMenuItems(restaurant.id, category.id);
  if (menuItems.length === 0) {
    throw new Error('No menu items available for finance demo seed.');
  }

  let cashier = await prisma.user.findFirst({
    where: {
      restaurantId: restaurant.id,
      role: { in: ['CASHIER', 'RESTAURANT_OWNER', 'BRANCH_MANAGER'] },
      active: true,
    },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  if (!cashier) {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('cashier123', 10);
    cashier = await prisma.user.create({
      data: {
        email: `cashier.${restaurant.slug}@restaurant.local`,
        passwordHash,
        role: 'CASHIER',
        active: true,
        restaurantId: restaurant.id,
        branchId: branch.id,
        firstName: 'Hasan',
        lastName: 'Ali',
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    console.log(`✅ Created demo cashier Hasan Ali (${cashier.email})`);
  } else if (!cashier.firstName) {
    cashier = await prisma.user.update({
      where: { id: cashier.id },
      data: { firstName: 'Hasan', lastName: cashier.lastName || 'Ali' },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }

  console.log(`📊 Seeding ${count} finance-demo transactions for ${year}`);
  console.log(`   Restaurant: ${restaurant.name} (${restaurant.slug})`);
  console.log(`   Branch: ${branch.name}`);
  console.log(
    `   Cashier: ${[cashier.firstName, cashier.lastName].filter(Boolean).join(' ') || cashier.email}`,
  );
  console.log(`   Tax rate: ${restaurant.taxRatePercent}%`);
  console.log(`   Menu items: ${menuItems.length}`);

  const moments = Array.from({ length: count }, () => randomSaleMoment(year)).sort(
    (a, b) => a.getTime() - b.getTime(),
  );

  let created = 0;
  for (let offset = 0; offset < count; offset += BATCH_SIZE) {
    const slice = moments.slice(offset, offset + BATCH_SIZE);
    for (let i = 0; i < slice.length; i++) {
      await createTransaction({
        restaurantId: restaurant.id,
        branchId: branch!.id,
        cashierId: cashier.id,
        menuItems,
        paidAt: slice[i]!,
        index: offset + i,
      });
      created += 1;
    }
    console.log(`   … ${created}/${count}`);
  }

  const demoPayments = await prisma.payment.count({
    where: {
      order: { restaurantId: restaurant.id, customerName: DEMO_TAG },
      status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
    },
  });

  const journalCount = await prisma.journalEntry.count({
    where: {
      restaurantId: restaurant.id,
      payment: { order: { customerName: DEMO_TAG } },
    },
  });

  console.log(`✅ Created ${created} paid orders (${demoPayments} payments, ${journalCount} journal lines).`);
  console.log('');
  console.log('Reports to verify in Admin:');
  console.log(`   Ledger → From ${year}-01-01 To ${year}-12-31`);
  console.log(`   Product sales → same date range, restaurant "${restaurant.name}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
