import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { ValidationError } from "@/lib/errors";

async function xlsx(rows: (string | number)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer).buffer;
}

describe("parseSpreadsheet", () => {
  it("reads .xlsx with normalised headers, numbers as text, and real row numbers", async () => {
    const data = await xlsx([["SKU", "GST %", "Opening Stock"], ["LJC-01", 18, 120], [], ["RJC-01", 12, 40]]);
    const { headers, rows } = await parseSpreadsheet(data, "stock.xlsx");
    expect(headers).toEqual(["sku", "gst", "openingstock"]);
    expect(rows).toEqual([
      { rowNumber: 2, values: { sku: "LJC-01", gst: "18", openingstock: "120" } },
      { rowNumber: 4, values: { sku: "RJC-01", gst: "12", openingstock: "40" } },
    ]);
  });

  it("reads .csv including a UTF-8 BOM and quoted commas", async () => {
    const BOM = String.fromCharCode(0xfeff);
    const text = `${BOM}SKU,Name,Qty\nLJC-01,"Lavender, Jar",1200\n`;
    const { rows } = await parseSpreadsheet(new TextEncoder().encode(text).buffer as ArrayBuffer, "s.csv");
    expect(rows[0].values).toEqual({ sku: "LJC-01", name: "Lavender, Jar", qty: "1200" });
  });

  it("rejects other file types", async () => {
    await expect(parseSpreadsheet(new ArrayBuffer(4), "old.xls")).rejects.toThrow(ValidationError);
  });
});
