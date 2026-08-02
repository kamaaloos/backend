import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  let restaurant = await prisma.restaurant.findFirst();

  if (!restaurant) {
    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Demo Restaurant',
        slug: 'demo-restaurant',
        active: true,
      },
    });
    console.log('Created restaurant:', restaurant.id);
  } else {
    console.log('Using restaurant:', restaurant.id, restaurant.name);
  }

  let category = await prisma.menuCategory.findFirst({
    where: { restaurantId: restaurant.id },
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
    console.log('Created category:', category.id);
  } else {
    console.log('Using category:', category.id, category.name);
  }

  const item = await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: category.id,
      name: 'Margherita Pizza',
      description: 'Tomato, mozzarella, and fresh basil',
      price: 12.5,
      active: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        id: item.id,
        name: item.name,
        price: item.price,
        categoryId: item.categoryId,
        restaurantId: item.restaurantId,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
