import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const r = await p.menuCategory.findMany({
    select: { name: true, displayOrder: true },
    orderBy: { displayOrder: 'asc' },
  });
  console.log(JSON.stringify(r, null, 2));
  await p.$disconnect();
}

main();
