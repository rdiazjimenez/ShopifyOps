import * as XLSX from "xlsx";

export type Command = "UPDATE" | "MERGE";

export type SkippedRow = { row: number; reason: string; skipped: true };

export type ParsedRow =
  | {
      skipped: false;
      row: number;
      command: Command;
      variantId?: string;
      sku?: string;
      newSku?: string;
      handle?: string;
      price?: string;
      compareAtPrice?: string;
      cost?: string;
    }
  | SkippedRow;

const SUPPORTED_COMMANDS: Command[] = ["UPDATE", "MERGE"];
const UNSUPPORTED_COMMANDS = ["NEW", "DELETE", "REPLACE", "IGNORE"];

function cellValue(
  sheet: XLSX.WorkSheet,
  col: number,
  rowIdx: number
): string | undefined {
  const addr = XLSX.utils.encode_cell({ c: col, r: rowIdx });
  const cell = sheet[addr] as XLSX.CellObject | undefined;
  if (cell == null || cell.v == null) return undefined;
  const str = String(cell.v).trim();
  return str === "" ? undefined : str;
}

export function parseExcel(buffer: ArrayBuffer, sheetName: string): ParsedRow[] {
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: "array" });

  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const sheet = workbook.Sheets[sheetName] as XLSX.WorkSheet;
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");

  // Build header index from row 0
  const headerRow = range.s.r;
  const headers: Record<string, number> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const val = cellValue(sheet, c, headerRow);
    if (val != null) headers[val.toLowerCase()] = c;
  }

  const colOf = (name: string): number | undefined => headers[name.toLowerCase().trim()];

  const results: ParsedRow[] = [];

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const rowNum = r - headerRow; // 1-based data row number

    const commandRaw = colOf("Command") != null
      ? cellValue(sheet, colOf("Command")!, r)
      : undefined;

    if (!commandRaw) {
      results.push({ row: rowNum, reason: "missing command", skipped: true });
      continue;
    }

    const commandUpper = commandRaw.toUpperCase();

    if (UNSUPPORTED_COMMANDS.includes(commandUpper)) {
      results.push({
        row: rowNum,
        reason: `unsupported command: ${commandRaw}`,
        skipped: true,
      });
      continue;
    }

    if (!SUPPORTED_COMMANDS.includes(commandUpper as Command)) {
      results.push({
        row: rowNum,
        reason: `unsupported command: ${commandRaw}`,
        skipped: true,
      });
      continue;
    }

    const command = commandUpper as Command;

    const parsed: ParsedRow & { skipped: false } = { skipped: false, row: rowNum, command };

    const variantIdCol = colOf("Variant ID");
    if (variantIdCol != null) {
      const v = cellValue(sheet, variantIdCol, r);
      if (v != null) parsed.variantId = v;
    }

    const skuCol = colOf("Variant SKU");
    if (skuCol != null) {
      const v = cellValue(sheet, skuCol, r);
      if (v != null) {
        if (parsed.variantId) parsed.newSku = v;
        else parsed.sku = v;
      }
    }

    const handleCol = colOf("Handle");
    if (handleCol != null) {
      const v = cellValue(sheet, handleCol, r);
      if (v != null) parsed.handle = v;
    }

    const priceCol = colOf("Variant Price");
    if (priceCol != null) {
      const v = cellValue(sheet, priceCol, r);
      if (v != null) parsed.price = v;
    }

    const compareAtCol = colOf("Variant Compare At Price");
    if (compareAtCol != null) {
      const v = cellValue(sheet, compareAtCol, r);
      if (v != null) parsed.compareAtPrice = v;
    }

    const costCol = colOf("Variant Cost");
    if (costCol != null) {
      const v = cellValue(sheet, costCol, r);
      if (v != null) parsed.cost = v;
    }

    results.push(parsed);
  }

  return results;
}
