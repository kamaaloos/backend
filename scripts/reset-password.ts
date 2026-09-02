import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: node --import tsx scripts/reset-password.ts <email> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({
    where: { email },
    data: { passwordHash },
    select: { email: true, role: true },
  });
  console.log(`Password updated for ${user.email} (${user.role})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
