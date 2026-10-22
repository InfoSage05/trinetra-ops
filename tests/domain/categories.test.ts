import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { assignCategory, createCategory, deleteCategory, listCategories, renameCategory } from "@/domain/categories";
import { createProduct, deleteProduct, updateProduct } from "@/domain/products";
import { quickEditProduct } from "@/domain/products";
import { createBill } from "@/domain/billing";
import { getStockOverview } from "@/domain/reports";
import { recordProduction } from "@/domain/stock";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);

const base = { hsnCode: "3406", unitPrice: "10", gstRate: "5" };

async function world() {
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  return { owner, worker };
}

describe("categories", () => {
  it("the owner makes, renames and deletes them; names must be different from each other", async () => {
    const { owner } = await world();
    const birthday = await createCategory(owner, { name: "  BIRTHDAY   CANDLE " });
    expect(birthday.name).toBe("BIRTHDAY CANDLE");
    await expect(createCategory(owner, { name: "birthday candle" })).rejects.toMatchObject({ code: "DUPLICATE_CATEGORY" });
    await expect(createCategory(owner, { name: "   " })).rejects.toBeInstanceOf(ValidationError);
    const lion = await createCategory(owner, { name: "LION CANDLE" });
    expect((await renameCategory(owner, { id: lion.id, name: "LION" })).name).toBe("LION");
    await expect(renameCategory(owner, { id: lion.id, name: "Birthday Candle" })).rejects.toBeInstanceOf(DomainError);
    await deleteCategory(owner, { id: lion.id });
    expect((await listCategories(owner)).map((c) => c.name)).toEqual(["BIRTHDAY CANDLE"]);
    await expect(deleteCategory(owner, { id: lion.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("workers can read them but not change them", async () => {
    const { owner, worker } = await world();
    await createCategory(owner, { name: "DEMPHY" });
    expect((await listCategories(worker)).map((c) => c.name)).toEqual(["DEMPHY"]);
    await expect(createCategory(worker, { name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignCategory(worker, { productIds: ["a"], categoryId: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the owner decides which items go in which category; nothing is placed automatically", async () => {
    const { owner } = await world();
    const birthday = await createCategory(owner, { name: "BIRTHDAY CANDLE" });
    const a = await createProduct(owner, { ...base, name: "BIRTH DAY-12", size: "12" });
    const b = await createProduct(owner, { ...base, name: "BIRTH DAY-17", size: "17", categoryId: birthday.id });
    const c = await createProduct(owner, { ...base, name: "Lion" });
    expect(a.categoryId).toBeNull(); // a name that looks like "birthday" is still not sorted by itself
    expect(b.categoryId).toBe(birthday.id);
    expect(a.size).toBe("12");

    expect(await assignCategory(owner, { productIds: [a.id, c.id], categoryId: birthday.id })).toEqual({ moved: 2 });
    const overview = await getStockOverview(owner, {});
    expect(overview.find((p) => p.id === c.id)).toMatchObject({ categoryId: birthday.id, categoryName: "BIRTHDAY CANDLE" });
    expect((await listCategories(owner))[0].itemCount).toBe(3);

    expect(await assignCategory(owner, { productIds: [c.id], categoryId: "" })).toEqual({ moved: 1 }); // out of any category
    expect((await prisma.product.findUniqueOrThrow({ where: { id: c.id } })).categoryId).toBeNull();
    await expect(assignCategory(owner, { productIds: [c.id], categoryId: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createProduct(owner, { ...base, name: "Bad", categoryId: "nope" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateProduct(owner, { id: a.id, ...base, name: "BIRTH DAY-12", categoryId: "nope" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleting a category keeps its items, which simply have no category afterwards", async () => {
    const { owner } = await world();
    const cat = await createCategory(owner, { name: "STAND CANDLE" });
    const item = await createProduct(owner, { ...base, name: "Stand 1", categoryId: cat.id });
    expect(await deleteCategory(owner, { id: cat.id })).toMatchObject({ itemsLeftWithoutCategory: 1 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: item.id } })).categoryId).toBeNull();
  });

  it("a size can be set, changed and cleared", async () => {
    const { owner } = await world();
    const item = await createProduct(owner, { ...base, name: "Masjid 8", size: "8" });
    expect((await updateProduct(owner, { id: item.id, name: "Masjid 8", ...base, size: "3 x 14" })).size).toBe("3 x 14");
    expect((await updateProduct(owner, { id: item.id, name: "Masjid 8", ...base, size: "" })).size).toBeNull();
    await expect(createProduct(owner, { ...base, name: "Long", size: "x".repeat(40) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the 24 category names the owner asked for are in the seed list exactly as he wrote them", () => {
    const { categories } = JSON.parse(readFileSync("prisma/seed-data/categories.json", "utf-8")) as { categories: string[] };
    expect(categories).toHaveLength(24);
    expect(categories).toEqual(expect.arrayContaining([
      "6 STICK STANDARD CANDLE", "DEMPHY", "5 INC MARBLE", "4.5 INC MARBLE", "CRYSTAL PLASTIC JARI", "COLOR CANDLE", "TAPPER SPIRAL CANDLE",
      "CHESS CANDLE", "ALUMINIUM KATORI CANDLE", "BIRTHDAY CANDLE", "MUSEUM CANDLE", "TAJMAHAL CANDLE", "LION CANDLE", "VICTORIA CANDLE",
      "DOUBLE TIGER", "SINGLE TIGER", "SPECIAL CANDLE", "CHARMINAR CANDLE", "FLOWER CANDLE", "MUD ITEM WITH WAX", "MUD ITEM WITHOUT WAX",
      "STAND CANDLE", "RIBB CANDLE", "GHATI PILLAR CANDLE",
    ]));
    expect(new Set(categories.map((c) => c.toLowerCase())).size).toBe(24);
  });
});

describe("deleting an item", () => {
  it("works for an item added by mistake, even after its rate was changed, and the owner only", async () => {
    const { owner, worker } = await world();
    const item = await createProduct(owner, { ...base, name: "Typo item" });
    await quickEditProduct(owner, { id: item.id, unitPrice: "20" }); // leaves a rate history row behind
    expect(await prisma.productRateChange.count({ where: { productId: item.id } })).toBe(1);
    await expect(deleteProduct(worker, { id: item.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await deleteProduct(owner, { id: item.id })).toEqual({ name: "Typo item" });
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productRateChange.count()).toBe(0);
    await expect(deleteProduct(owner, { id: item.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is refused for an item with stock or bills, which can be hidden instead", async () => {
    await makeBusinessProfile();
    await makeSeries("INVOICE");
    const { owner } = await world();
    const customer = await makeCustomer();
    const made = await createProduct(owner, { ...base, name: "Made item" });
    await recordProduction(owner, { productId: made.id, quantity: "5", idempotencyKey: "del-prod-0001" });
    await expect(deleteProduct(owner, { id: made.id })).rejects.toMatchObject({ code: "PRODUCT_IN_USE" });

    const billed = await createProduct(owner, { ...base, name: "Billed item" });
    await addStock(billed.id, "10.00");
    await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "del-bill-0001", lines: [{ productId: billed.id, quantity: "1" }] });
    const error = await deleteProduct(owner, { id: billed.id }).catch((e) => e);
    expect(error.code).toBe("PRODUCT_IN_USE");
    expect(error.message).toMatch(/Deactivate/);
    expect(await prisma.product.count()).toBe(2); // nothing was removed
  });
});
