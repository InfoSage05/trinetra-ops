import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { previewBill } from "@/domain/billing";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeCustomer, makeProduct, makeUser, setupBillingWorld, MAHARASHTRA } from "../helpers/factories";

const s = (v: { toFixed(n: number): string }) => v.toFixed(2);

describe("previewBill", () => {
  beforeEach(resetDb);

  it("prices an in-stock intra-state bill", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const preview = await previewBill(owner, { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "10" }] });
    expect(preview.interState).toBe(false);
    expect(preview.hasShortfall).toBe(false);
    expect(s(preview.lines[0].availableBefore)).toBe("100.00");
    expect([s(preview.cgstTotal), s(preview.sgstTotal), s(preview.grandTotal)]).toEqual(["135.00", "135.00", "1770.00"]);
  });

  it("charges IGST when the place of supply is another state", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const preview = await previewBill(owner, { customerId: customer.id, placeOfSupply: MAHARASHTRA, lines: [{ productId: product.id, quantity: "10" }] });
    expect(preview.interState).toBe(true);
    expect(preview.placeOfSupplyName).toBe("Maharashtra");
    expect(s(preview.igstTotal)).toBe("270.00");
  });

  it("detects a shortfall across two lines of the same product", async () => {
    const { owner, customer } = await setupBillingWorld();
    const scarce = await makeProduct();
    await addStock(scarce.id, "8.00");
    const preview = await previewBill(owner, {
      customerId: customer.id, placeOfSupply: "21",
      lines: [{ productId: scarce.id, quantity: "5" }, { productId: scarce.id, quantity: "5" }],
    });
    expect(preview.lines[0].shortfallQuantity).toBeNull();
    expect(s(preview.lines[1].availableBefore)).toBe("3.00");
    expect(s(preview.lines[1].shortfallQuantity!)).toBe("2.00");
    expect(preview.hasShortfall).toBe(true);
  });

  it("applies a price override and a line discount", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const preview = await previewBill(owner, {
      customerId: customer.id, placeOfSupply: "21",
      lines: [{ productId: product.id, quantity: "10", unitPrice: "140", discountAmount: "100" }],
    });
    expect([s(preview.lines[0].taxableValue), s(preview.grandTotal)]).toEqual(["1300.00", "1534.00"]);
  });

  it("explains what is missing or wrong", async () => {
    const owner = await makeUser("OWNER");
    const customer = await makeCustomer();
    const product = await makeProduct();
    await expect(previewBill(owner, { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "1" }] }))
      .rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });

    const world = await setupBillingWorld();
    await prisma.product.update({ where: { id: world.product.id }, data: { isActive: false } });
    await expect(previewBill(world.owner, { customerId: world.customer.id, placeOfSupply: "21", lines: [{ productId: world.product.id, quantity: "1" }] }))
      .rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
    await expect(previewBill(world.owner, { customerId: world.customer.id, placeOfSupply: "21", lines: [] })).rejects.toThrow(ValidationError);
    await expect(previewBill(world.worker, { customerId: world.customer.id, placeOfSupply: "21", lines: [] })).rejects.toThrow(ForbiddenError);
  });
});
