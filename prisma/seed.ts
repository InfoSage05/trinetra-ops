import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function seedOwner() {
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

/**
 * The factory's own item and customer names (from "Order 2026.xlsx"), added only when missing, so it is safe to run
 * again and never overwrites a name, price or carton size the owner has since changed.
 * Placeholders: price 0 ("Price not set" shows in Products), HSN 3406 (candles) and GST 18%, one piece per carton.
 * The owner/CA must set the real price, GST rate and carton size per item.
 */
async function seedCatalogue() {
  const file = new URL("./seed-data/catalogue.json", import.meta.url);
  const { products, customers } = JSON.parse(readFileSync(file, "utf-8")) as { products: string[]; customers: string[] };

  const haveProducts = new Set((await prisma.product.findMany({ select: { name: true } })).map((p) => p.name.toLowerCase()));
  const newProducts = products.filter((n) => !haveProducts.has(n.toLowerCase()));
  if (newProducts.length > 0) {
    await prisma.product.createMany({ data: newProducts.map((name) => ({ name, hsnCode: "3406", unitPrice: "0.00", gstRate: "18.00" })) });
  }

  const haveCustomers = new Set((await prisma.customer.findMany({ select: { name: true } })).map((c) => c.name.toLowerCase()));
  const newCustomers = customers.filter((n) => !haveCustomers.has(n.toLowerCase()));
  if (newCustomers.length > 0) {
    await prisma.customer.createMany({ data: newCustomers.map((name) => ({ name, billingAddress: "Address not entered yet", stateCode: "21" })) });
  }
  console.log(`Catalogue: added ${newProducts.length} item(s) and ${newCustomers.length} customer(s).`);
}

async function main() {
  await seedOwner();
  await seedCatalogue();
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
