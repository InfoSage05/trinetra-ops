import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.argv[2]);
const ws = wb.worksheets[0];
const t = (v: unknown) => (v && typeof v === "object" && "richText" in (v as object) ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("") : v);
ws.eachRow({ includeEmpty: false }, (row, r) => {
  const a = t(row.getCell(1).value);
  console.log(r, JSON.stringify(a), "| nonnull cols:", (row.values as unknown[]).slice(2).filter((v) => v !== null && v !== undefined).length);
});
const h = ws.getRow(1); console.log("row1:", JSON.stringify((h.values as unknown[]).slice(1)));
