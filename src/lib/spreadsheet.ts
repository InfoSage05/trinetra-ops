import ExcelJS from "exceljs";
import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";

export type SheetRow = { rowNumber: number; values: Record<string, string> };
export const MAX_IMPORT_ROWS = 2000;

export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue); // formula
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text); // hyperlink
    return "";
  }
  return String(value).trim();
}

async function readMatrix(data: ArrayBuffer, fileName: string): Promise<{ rowNumber: number; cells: string[] }[]> {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv")) {
    const raw = new TextDecoder("utf-8").decode(data);
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip Excel's UTF-8 BOM
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    return parsed.data.map((cells, i) => ({ rowNumber: i + 1, cells: cells.map((c) => String(c ?? "").trim()) }));
  }
  if (name.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    // exceljs typings for load() vary across @types/node versions; at runtime it accepts a Node Buffer.
    await workbook.xlsx.load(Buffer.from(data) as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ValidationError("The Excel file has no sheets.");
    const out: { rowNumber: number; cells: string[] }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
      out.push({ rowNumber: row.number, cells: Array.from(cells, (c) => c ?? "") });
    });
    return out;
  }
  throw new ValidationError("Upload an Excel (.xlsx) or CSV (.csv) file. Old .xls files: open in Excel and 'Save As' .xlsx.");
}

export async function parseSpreadsheet(data: ArrayBuffer, fileName: string): Promise<{ headers: string[]; rows: SheetRow[] }> {
  const matrix = (await readMatrix(data, fileName)).filter((r) => r.cells.some((c) => c !== ""));
  if (matrix.length === 0) throw new ValidationError("The file is empty.");
  const [headerRow, ...body] = matrix;
  if (body.length > MAX_IMPORT_ROWS) throw new ValidationError(`Too many rows (max ${MAX_IMPORT_ROWS}). Split the file.`);
  const headers = headerRow.cells.map(normaliseHeader);
  const rows = body.map(({ rowNumber, cells }) => ({
    rowNumber,
    values: Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]).filter(([h]) => h !== "")),
  }));
  return { headers, rows };
}
