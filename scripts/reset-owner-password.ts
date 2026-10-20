import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

// Usage: npm run user:reset-password -- 9999999999 "temporary-pass-123"
async function main() {
  const [phone, temporaryPassword] = process.argv.slice(2);
  if (!phone || !temporaryPassword || temporaryPassword.length < 8) {
    throw new Error('Usage: npm run user:reset-password -- <10-digit phone> "<temporary password, 8+ chars>"');
  }
  const user = await prisma.user.update({
    where: { phone },
    data: {
      passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, isActive: true,
      failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 },
    },
  });
  console.log(`Password reset for ${user.name} (${user.phone}). They must change it at next login.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
