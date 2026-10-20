import { prisma } from "@/lib/db";
import { hashPassword, type Role, type Session } from "@/lib/auth";
import { financialYearOf } from "@/lib/time";
import type { Prisma } from "@/generated/prisma/client";

export const ODISHA = "21";
export const MAHARASHTRA = "27";
export const BUSINESS_GSTIN = "21AAAAA0000A1ZE";
export const ODISHA_CUSTOMER_GSTIN = "21BBBBB1111B1ZZ";
export const MAHARASHTRA_CUSTOMER_GSTIN = "27AAPFU0939F1ZV";

let counter = 0;
const nextId = () => ++counter;

export async function makeUser(
  role: Role = "OWNER",
  opts: { name?: string; phone?: string; password?: string; isActive?: boolean } = {}
): Promise<Session> {
  const n = nextId();
  const user = await prisma.user.create({
    data: {
      name: opts.name ?? `${role === "OWNER" ? "Owner" : "Worker"} ${n}`,
      phone: opts.phone ?? `9${String(n).padStart(9, "0")}`,
      passwordHash: opts.password ? await hashPassword(opts.password) : "not-a-real-hash",
      role,
      isActive: opts.isActive ?? true,
    },
  });
  return { userId: user.id, role, name: user.name, mustChangePassword: false };
}

export async function makeBusinessProfile(overrides: Partial<Prisma.BusinessProfileCreateInput> = {}) {
  const data = {
    legalName: "Trinetra Candles", gstin: BUSINESS_GSTIN, stateCode: ODISHA,
    addressLine1: "Plot 12, Industrial Estate", city: "Cuttack", pincode: "753001", phone: "9437000000",
    ...overrides,
  };
  return prisma.businessProfile.upsert({ where: { id: "default" }, create: data, update: data });
}

export async function makeSeries(
  series: "INVOICE" | "CREDIT_NOTE" = "INVOICE",
  opts: { prefix?: string; financialYear?: string } = {}
) {
  return prisma.numberSeries.create({
    data: { series, prefix: opts.prefix ?? (series === "INVOICE" ? "TC" : "CN"), financialYear: opts.financialYear ?? financialYearOf() },
  });
}

export async function makeCustomer(overrides: Partial<Prisma.CustomerUncheckedCreateInput> = {}) {
  const n = nextId();
  return prisma.customer.create({
    data: { name: `Customer ${n}`, phone: `8${String(n).padStart(9, "0")}`, billingAddress: "Market Road, Cuttack", stateCode: ODISHA, ...overrides },
  });
}

export async function makeProduct(overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  const n = nextId();
  return prisma.product.create({
    data: { sku: `SKU-${n}`, name: `Candle ${n}`, hsnCode: "3406", unitPrice: "150.00", gstRate: "18.00", ...overrides },
  });
}

/** Writes a ledger row directly (no domain rules), for arranging test state only. */
export async function addStock(
  productId: string,
  quantity: string,
  type: "OPENING" | "PRODUCED" | "ADJUSTMENT" = "PRODUCED"
) {
  return prisma.stockLedgerEntry.create({
    data: {
      productId, quantityDelta: quantity, type, createdBy: "fixture",
      reason: type === "ADJUSTMENT" ? "fixture" : null, idempotencyKey: `fixture:${nextId()}`,
    },
  });
}

export async function setupBillingWorld() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  await makeSeries("CREDIT_NOTE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const customer = await makeCustomer();
  const product = await makeProduct();
  await addStock(product.id, "100.00");
  return { owner, worker, customer, product };
}
