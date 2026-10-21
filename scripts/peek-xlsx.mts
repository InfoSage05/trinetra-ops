import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.argv[2]);
for (const ws of wb.worksheets) {
  console.log(`== sheet "${ws.name}" rows=${ws.rowCount} cols=${ws.columnCount}`);
  let n = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (n++ < Number(process.argv[3] ?? 25)) console.log(r, JSON.stringify((row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v))));
  });
}
