import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const existingOwner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (existingOwner) {
    console.log(`Owner already exists (${existingOwner.phone}); nothing to seed.`);
    return;
  }
  const name = process.env.SEED_OWNER_NAME ?? "Owner";
  const phone = process.env.SEED_OWNER_PHONE;
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) throw new Error("Set SEED_OWNER_PHONE to a 10-digit mobile number in .env");
  if (!password || password.length < 8) throw new Error("Set SEED_OWNER_PASSWORD (8+ characters) in .env");

  await prisma.user.create({
    data: { name, phone, role: "OWNER", passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  console.log(`Created owner login ${phone}. You will be asked to change the password on first login.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
