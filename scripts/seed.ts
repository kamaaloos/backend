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
      passwordHash: adminHash,
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
  console.log('✅ Platform Admin created (admin@restaurant.local / admin123)');

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
        active: true,
      },
    });
  } else if (branch.walkInToken !== E2E_FIXTURES.walkInToken) {
    branch = await prisma.branch.update({
      where: { id: branch.id },
      data: { walkInToken: E2E_FIXTURES.walkInToken, active: true },
    });
  }
  console.log('✅ Demo restaurant + branch (walkInToken fixed for e2e)');

  await prisma.user.upsert({
    where: { email: 'cashier@restaurant.local' },
    update: {
      passwordHash: cashierHash,
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
  console.log('✅ Cashier created (cashier@restaurant.local / cashier123)');

  const existingTable = await prisma.table.findFirst({
    where: {
      OR: [
        { qrToken: E2E_FIXTURES.tableQrToken },
        { branchId: branch.id, number: '1' },
      ],
    },
  });
  if (!existingTable) {
    await prisma.table.create({
      data: {
        branchId: branch.id,
        number: '1',
        seats: 4,
        qrToken: E2E_FIXTURES.tableQrToken,
      },
    });
  } else if (existingTable.qrToken !== E2E_FIXTURES.tableQrToken) {
    await prisma.table.update({
      where: { id: existingTable.id },
      data: { qrToken: E2E_FIXTURES.tableQrToken },
    });
  }
  console.log('✅ Demo table QR token');

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
    await prisma.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: category.id,
        name: 'Margherita Pizza',
        description: 'Tomato, mozzarella, and fresh basil',
        price: 12.5,
        active: true,
      },
    });
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
