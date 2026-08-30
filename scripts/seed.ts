import {
  DeviceType,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Stable fixtures for local + CI Playwright / API e2e. */
export const E2E_FIXTURES = {
  restaurantSlug: 'demo-restaurant',
  walkInToken: 'e2e00000-0004-4000-8000-000000000001',
  tableQrToken: 'c295c2df-cc43-49bd-8bd5-5f7484fa9061',
  tableOrderPin: '123456',
  kitchenDeviceToken: 'e2e00000-0001-4000-8000-000000000001',
  waiterDeviceToken: 'e2e00000-0002-4000-8000-000000000001',
  pickupDeviceToken: 'e2e00000-0003-4000-8000-000000000001',
} as const;

async function main() {
  const adminHash = await bcrypt.hash('admin123', 10);
  const cashierHash = await bcrypt.hash('cashier123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@restaurant.local' },
    update: {
      // Do not reset password on re-seed — rotate in Admin after first install.
      role: UserRole.PLATFORM_ADMIN,
      active: true,
    },
    create: {
      email: 'admin@restaurant.local',
      passwordHash: adminHash,
      role: UserRole.PLATFORM_ADMIN,
      active: true,
    },
  });
  console.log('✅ Platform Admin ensured (admin@restaurant.local)');
  console.warn(
    '⚠️  Demo seed credentials (admin123 / cashier123) are for local/CI only. Change or delete them before production.',
  );

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: E2E_FIXTURES.restaurantSlug },
    update: { name: 'Demo Restaurant', active: true },
    create: {
      name: 'Demo Restaurant',
      slug: E2E_FIXTURES.restaurantSlug,
      currency: 'EUR',
      timezone: 'Europe/Helsinki',
      active: true,
    },
  });

  let branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
  });

  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: 'Downtown',
        restaurantId: restaurant.id,
        walkInToken: E2E_FIXTURES.walkInToken,
        walkInTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000),
        active: true,
      },
    });
  } else if (branch.walkInToken !== E2E_FIXTURES.walkInToken) {
    branch = await prisma.branch.update({
      where: { id: branch.id },
      data: {
        walkInToken: E2E_FIXTURES.walkInToken,
        walkInTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000),
        active: true,
      },
    });
  } else if (
    !branch.walkInTokenExpiresAt ||
    branch.walkInTokenExpiresAt.getTime() <= Date.now()
  ) {
    branch = await prisma.branch.update({
      where: { id: branch.id },
      data: { walkInTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000) },
    });
  }
  console.log('✅ Demo restaurant + branch (walkInToken fixed for e2e)');

  await prisma.user.upsert({
    where: { email: 'cashier@restaurant.local' },
    update: {
      // Do not reset password on re-seed.
      role: UserRole.CASHIER,
      active: true,
      restaurantId: restaurant.id,
      branchId: branch.id,
    },
    create: {
      email: 'cashier@restaurant.local',
      passwordHash: cashierHash,
      role: UserRole.CASHIER,
      active: true,
      restaurantId: restaurant.id,
      branchId: branch.id,
    },
  });
  console.log('✅ Cashier ensured (cashier@restaurant.local)');

  // Keep the E2E QR on the demo branch (not a stray restaurant from local demos).
  await prisma.table.updateMany({
    where: {
      qrToken: E2E_FIXTURES.tableQrToken,
      NOT: { branchId: branch.id },
    },
    data: { qrToken: null },
  });

  const existingTable = await prisma.table.findFirst({
    where: { branchId: branch.id, number: '1' },
  });
  const tableOrderPinHash = await bcrypt.hash(E2E_FIXTURES.tableOrderPin, 10);
  if (!existingTable) {
    await prisma.table.create({
      data: {
        branchId: branch.id,
        number: '1',
        seats: 4,
        qrToken: E2E_FIXTURES.tableQrToken,
        qrCode: E2E_FIXTURES.tableQrToken,
        qrTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000),
        orderPinHash: tableOrderPinHash,
        orderPinVersion: 1,
      },
    });
  } else {
    await prisma.table.update({
      where: { id: existingTable.id },
      data: {
        qrToken: E2E_FIXTURES.tableQrToken,
        qrCode: E2E_FIXTURES.tableQrToken,
        qrTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000),
        orderPinHash: tableOrderPinHash,
        orderPinVersion: existingTable.orderPinVersion > 0
          ? existingTable.orderPinVersion
          : 1,
        deletedAt: null,
        seats: existingTable.seats || 4,
      },
    });
  }
  console.log('✅ Demo table QR token + order PIN (123456)');

  let category = await prisma.menuCategory.findFirst({
    where: { restaurantId: restaurant.id },
    orderBy: { displayOrder: 'asc' },
  });
  if (!category) {
    category = await prisma.menuCategory.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mains',
        displayOrder: 1,
        active: true,
      },
    });
  }

  const menuCount = await prisma.menuItem.count({
    where: { restaurantId: restaurant.id, active: true },
  });
  if (menuCount === 0) {
    await prisma.menuItem.createMany({
      data: [
        {
          restaurantId: restaurant.id,
          categoryId: category.id,
          name: 'Margherita Pizza',
          description: 'Tomato, mozzarella, and fresh basil',
          price: 12.5,
          imageUrl: 'menu/margherita.jpg',
          active: true,
        },
        {
          restaurantId: restaurant.id,
          categoryId: category.id,
          name: 'Caesar Salad',
          description: 'Romaine, Parmesan, croutons, Caesar dressing',
          price: 9.5,
          imageUrl: 'menu/caesar-salad.jpg',
          active: true,
        },
        {
          restaurantId: restaurant.id,
          categoryId: category.id,
          name: 'Tiramisu',
          description: 'Espresso-soaked ladyfingers and mascarpone',
          price: 7.5,
          imageUrl: 'menu/tiramisu.jpg',
          active: true,
        },
      ],
    });
  } else {
    // Attach bundled demo images when items exist without imageUrl
    const demos: Array<{ name: string; imageUrl: string }> = [
      { name: 'Margherita Pizza', imageUrl: 'menu/margherita.jpg' },
      { name: 'Caesar Salad', imageUrl: 'menu/caesar-salad.jpg' },
      { name: 'Greek salad', imageUrl: 'menu/salad-greek.jpg' },
      { name: 'Greek Salad', imageUrl: 'menu/salad-greek.jpg' },
      { name: 'Garden salad', imageUrl: 'menu/salad-garden.jpg' },
      { name: 'Garden Salad', imageUrl: 'menu/salad-garden.jpg' },
      { name: 'Tuna salad', imageUrl: 'menu/salad-tuna.jpg' },
      { name: 'Tuna Salad', imageUrl: 'menu/salad-tuna.jpg' },
      { name: 'Chicken salad', imageUrl: 'menu/salad-chicken.jpg' },
      { name: 'Chicken Salad', imageUrl: 'menu/salad-chicken.jpg' },
      { name: 'Avocado salad', imageUrl: 'menu/salad-avocado.jpg' },
      { name: 'Avocado Salad', imageUrl: 'menu/salad-avocado.jpg' },
      { name: 'Caprese salad', imageUrl: 'menu/salad-caprese.jpg' },
      { name: 'Caprese Salad', imageUrl: 'menu/salad-caprese.jpg' },
      { name: 'Seafood salad', imageUrl: 'menu/salad-seafood.jpg' },
      { name: 'Seafood Salad', imageUrl: 'menu/salad-seafood.jpg' },
      { name: 'Tiramisu', imageUrl: 'menu/tiramisu.jpg' },
      { name: 'Sambusa', imageUrl: 'menu/sambusa.jpg' },
      { name: 'Bur', imageUrl: 'menu/bur.jpg' },
      { name: 'Somali-soup', imageUrl: 'menu/somali-soup.jpg' },
      { name: 'fish soup', imageUrl: 'menu/fish-soup.jpg' },
      { name: 'hot drinks ->Tea', imageUrl: 'menu/tea.jpg' },
      { name: 'Tea', imageUrl: 'menu/tea.jpg' },
      { name: 'Tea without milk', imageUrl: 'menu/tea-no-milk.jpg' },
      { name: 'Tea (no milk)', imageUrl: 'menu/tea-no-milk.jpg' },
      { name: 'Black tea', imageUrl: 'menu/tea-no-milk.jpg' },
      { name: 'Espresso', imageUrl: 'menu/coffee-espresso.jpg' },
      { name: 'Cappuccino', imageUrl: 'menu/coffee-cappuccino.jpg' },
      { name: 'Latte', imageUrl: 'menu/coffee-latte.jpg' },
      { name: 'Coffee', imageUrl: 'menu/coffee-espresso.jpg' },
      { name: 'Hot chocolate', imageUrl: 'menu/hot-chocolate.jpg' },
      { name: 'Hot Chocolate', imageUrl: 'menu/hot-chocolate.jpg' },
      { name: 'soft drink -> Fanta', imageUrl: 'menu/soft-drink.jpg' },
      { name: 'Lemonade', imageUrl: 'menu/cold-lemonade.jpg' },
      { name: 'Cola', imageUrl: 'menu/cold-cola.jpg' },
      { name: 'Orange juice', imageUrl: 'menu/cold-orange-juice.jpg' },
      { name: 'Chocolate shake', imageUrl: 'menu/shake-chocolate.jpg' },
      { name: 'Strawberry shake', imageUrl: 'menu/shake-strawberry.jpg' },
      { name: 'Vanilla shake', imageUrl: 'menu/shake-vanilla.jpg' },
      { name: 'Mango shake', imageUrl: 'menu/shake-mango.jpg' },
      { name: 'Pasta with fish', imageUrl: 'menu/pasta-fish.jpg' },
      { name: 'Pasta fish', imageUrl: 'menu/pasta-fish.jpg' },
      { name: 'Fish pasta', imageUrl: 'menu/pasta-fish.jpg' },
      { name: 'Lasagna', imageUrl: 'menu/pasta-lasagna.jpg' },
      { name: 'Pasta lasagna', imageUrl: 'menu/pasta-lasagna.jpg' },
      { name: 'Cream pasta', imageUrl: 'menu/pasta-cream.jpg' },
      { name: 'Pasta cream', imageUrl: 'menu/pasta-cream.jpg' },
      { name: 'Bolognese', imageUrl: 'menu/pasta-bolognese.jpg' },
      { name: 'Pasta bolognese', imageUrl: 'menu/pasta-bolognese.jpg' },
      { name: 'Soor', imageUrl: 'menu/soor.jpg' },
      { name: 'Somali soor', imageUrl: 'menu/soor.jpg' },
      { name: 'Bariis', imageUrl: 'menu/bariis.jpg' },
      { name: 'Suqaar', imageUrl: 'menu/suqaar.jpg' },
      { name: 'Grilled fish', imageUrl: 'menu/grilled-fish.jpg' },
      { name: 'Pasta with salmon', imageUrl: 'menu/pasta-salmon.jpg' },
      { name: 'Pasta salmon', imageUrl: 'menu/pasta-salmon.jpg' },
      { name: 'Salmon pasta', imageUrl: 'menu/pasta-salmon.jpg' },
      { name: 'Soor with salmon', imageUrl: 'menu/soor-salmon.jpg' },
      { name: 'Soor salmon', imageUrl: 'menu/soor-salmon.jpg' },
      { name: 'Soor with salamon', imageUrl: 'menu/soor-salmon.jpg' },
      { name: 'Pasta with salamon', imageUrl: 'menu/pasta-salmon.jpg' },
    ];
    for (const demo of demos) {
      await prisma.menuItem.updateMany({
        where: {
          name: { equals: demo.name, mode: 'insensitive' },
          OR: [{ imageUrl: null }, { imageUrl: '' }],
        },
        data: { imageUrl: demo.imageUrl },
      });
    }
  }
  console.log('✅ Demo menu');

  const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const devices: Array<{
    name: string;
    deviceType: DeviceType;
    token: string;
  }> = [
    {
      name: 'E2E Kitchen',
      deviceType: DeviceType.KITCHEN,
      token: E2E_FIXTURES.kitchenDeviceToken,
    },
    {
      name: 'E2E Waiter',
      deviceType: DeviceType.WAITER,
      token: E2E_FIXTURES.waiterDeviceToken,
    },
    {
      name: 'E2E Pickup Display',
      deviceType: DeviceType.CUSTOMER_DISPLAY,
      token: E2E_FIXTURES.pickupDeviceToken,
    },
  ];

  for (const d of devices) {
    const byToken = await prisma.device.findUnique({ where: { token: d.token } });
    if (byToken) {
      await prisma.device.update({
        where: { id: byToken.id },
        data: {
          branchId: branch.id,
          name: d.name,
          deviceType: d.deviceType,
          tokenExpiresAt,
        },
      });
      continue;
    }

    const byName = await prisma.device.findFirst({
      where: { branchId: branch.id, name: d.name },
    });
    if (byName) {
      await prisma.device.update({
        where: { id: byName.id },
        data: {
          token: d.token,
          deviceType: d.deviceType,
          tokenExpiresAt,
        },
      });
    } else {
      await prisma.device.create({
        data: {
          branchId: branch.id,
          name: d.name,
          deviceType: d.deviceType,
          token: d.token,
          tokenExpiresAt,
        },
      });
    }
  }

  console.log('✅ E2E device tokens:');
  console.log(`   KITCHEN_E2E_TOKEN=${E2E_FIXTURES.kitchenDeviceToken}`);
  console.log(`   WAITER_E2E_TOKEN=${E2E_FIXTURES.waiterDeviceToken}`);
  console.log(`   PICKUP_E2E_TOKEN=${E2E_FIXTURES.pickupDeviceToken}`);
  console.log(`   walkInToken=${E2E_FIXTURES.walkInToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
