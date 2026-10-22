import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { entityId, parseInput, requiredText } from "@/lib/validation";

/**
 * Categories are sections of the catalogue (BIRTHDAY CANDLE, DEMPHY, ...). The owner decides which item goes in which
 * one; nothing is ever sorted automatically. An item is in one category or in none.
 */

const nameSchema = requiredText("Category name", 60).transform((n) => n.replace(/\s+/g, " ").trim());

async function assertNameFree(name: string, exceptId?: string) {
  const clash = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new DomainError("DUPLICATE_CATEGORY", `A category named "${clash.name}" already exists.`);
}

/** All categories with how many items each holds (workers can read these too, to find items faster). */
export async function listCategories(session: Session | null) {
  requireRole(session, ["OWNER", "WORKER"]);
  const rows = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, itemCount: c._count.products }));
}

export async function createCategory(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { name } = parseInput(z.object({ name: nameSchema }), rawInput);
  await assertNameFree(name);
  const last = await prisma.category.aggregate({ _max: { sortOrder: true } });
  return prisma.category.create({ data: { name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
}

export async function renameCategory(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, name } = parseInput(z.object({ id: entityId, name: nameSchema }), rawInput);
  if (!(await prisma.category.findUnique({ where: { id } }))) throw new NotFoundError("Category");
  await assertNameFree(name, id);
  return prisma.category.update({ where: { id }, data: { name } });
}

/** Deleting a category never deletes items: they simply have no category until moved. */
export async function deleteCategory(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id } = parseInput(z.object({ id: entityId }), rawInput);
  const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!category) throw new NotFoundError("Category");
  await prisma.category.delete({ where: { id } }); // products.categoryId is set to empty by the database
  return { name: category.name, itemsLeftWithoutCategory: category._count.products };
}

/** Moves the chosen items into a category (or out of any, with categoryId null). */
export async function assignCategory(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({
      productIds: z.array(entityId).min(1, "Choose at least one item.").max(500),
      categoryId: z.preprocess((v) => (v === "" ? null : v), entityId.nullable()),
    }),
    rawInput
  );
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId } }))) throw new ValidationError("That category no longer exists.");
  const result = await prisma.product.updateMany({ where: { id: { in: input.productIds } }, data: { categoryId: input.categoryId } });
  return { moved: result.count };
}
