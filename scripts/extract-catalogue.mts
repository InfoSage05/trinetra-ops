// One-off: reads the factory's "Order 2026.xlsx" and writes prisma/seed-data/catalogue.json
// (product names from column A, customer names from the heading row). Quantities are ignored on purpose.
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const text = (v: unknown): string =>
  v && typeof v === "object" && "richText" in (v as object) ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("") : String(v ?? "");

// Collapse stray spaces/line breaks and write "14 x 12" the same way everywhere.
const tidy = (s: string) =>
  s.replace(/\s+/g, " ").trim().replace(/(\d)\s*[xX]\s*(\d)/g, "$1 x $2").replace(/^19 x 1 0\b/, "19 x 10");

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.argv[2]);
const ws = wb.worksheets[0];

const customers: string[] = [];
ws.getRow(2).eachCell((cell, col) => {
  const name = tidy(text(cell.value));
  if (col > 1 && name && name.toUpperCase() !== "TOTAL") customers.push(name);
});

const products: string[] = [];
ws.eachRow({ includeEmpty: false }, (row, r) => {
  if (r <= 2) return;
  const name = tidy(text(row.getCell(1).value));
  if (name) products.push(name);
});

const dupes = products.filter((p, i) => products.findIndex((q) => q.toLowerCase() === p.toLowerCase()) !== i);
if (dupes.length) console.log("Duplicate names:", dupes);
writeFileSync("prisma/seed-data/catalogue.json", JSON.stringify({ source: "Order 2026.xlsx", customers, products }, null, 2) + "\n");
console.log(`${products.length} products, ${customers.length} customers`);
console.log(customers.join(" | "));
