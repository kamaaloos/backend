/**
 * Runs `prisma migrate deploy` with retries for Neon cold starts (P1001).
 * Free/scale-to-zero compute can reject the first connections while waking.
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const maxAttempts = Number(process.env.PRISMA_MIGRATE_RETRIES || 8);
const baseDelayMs = Number(process.env.PRISMA_MIGRATE_RETRY_MS || 3000);

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  if (result.status === 0) {
    process.exit(0);
  }

  if (attempt === maxAttempts) {
    console.error(
      `prisma migrate deploy failed after ${maxAttempts} attempts (last exit ${result.status}).`,
    );
    process.exit(result.status ?? 1);
  }

  const waitMs = baseDelayMs * attempt;
  console.error(
    `prisma migrate deploy failed (attempt ${attempt}/${maxAttempts}); retrying in ${waitMs}ms…`,
  );
  await delay(waitMs);
}
