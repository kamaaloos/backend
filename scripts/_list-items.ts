import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const r = await p.menuItem.findMany({
    select: { name: true, description: true, imageUrl: true },
    orderBy: { name: "asc" },
  });
  console.log(JSON.stringify(r, null, 2));
  await p.$disconnect();
}

main();
