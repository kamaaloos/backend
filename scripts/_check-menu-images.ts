import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const r = await p.menuItem.findMany({
    select: { name: true, imageUrl: true },
  });
  console.log(JSON.stringify(r, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
