import { describe, it, expect, beforeEach, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createProductAction, importProductsAction } from "@/actions/products";
import { createCustomerAction } from "@/actions/customers";
import { resetDb } from "../helpers/db";
import { makeUser, MAHARASHTRA_CUSTOMER_GSTIN } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

async function xlsxFile(rows: (string | number)[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");
  rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)], "products.xlsx");
}

describe("master data actions", () => {
  beforeEach(resetDb);

  it("creates products for owners and returns FORBIDDEN for workers", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const ok = await createProductAction({ sku: "LJC-01", name: "Lavender", hsnCode: "3406", unitPrice: "150", gstRate: "18" });
    expect(ok.ok && ok.data.unitPrice).toBe("150"); // Decimal arrived as a plain string

    vi.mocked(getSession).mockResolvedValue(await makeUser("WORKER"));
    expect(await createProductAction({ sku: "X", name: "X", hsnCode: "3406", unitPrice: "1", gstRate: "18" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("previews then imports products from an uploaded Excel file", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const file = await xlsxFile([["SKU", "Name", "HSN", "GST %", "Price"], ["LJC-01", "Lavender Jar", "3406", 18, 150]]);

    const form = (dryRun: boolean) => { const f = new FormData(); f.set("file", file); f.set("dryRun", String(dryRun)); return f; };
    expect(await importProductsAction(form(true))).toMatchObject({ ok: true, data: { toCreate: 1, created: 0 } });
    expect(await importProductsAction(form(false))).toMatchObject({ ok: true, data: { created: 1 } });
    expect(await prisma.product.count()).toBe(1);
  });

  it("returns field errors when the customer state does not match the GSTIN", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const result = await createCustomerAction({ name: "Pune Traders", billingAddress: "Pune", stateCode: "21", gstin: MAHARASHTRA_CUSTOMER_GSTIN });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { stateCode: [expect.stringMatching(/GSTIN/)] } });
  });
});
