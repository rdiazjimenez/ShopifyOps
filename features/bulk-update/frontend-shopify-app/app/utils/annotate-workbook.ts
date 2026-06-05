import * as XLSX from "xlsx";

export interface ResultRow {
  row: number;
  lookupKey?: string;
  status: string;
  reason?: string;
}

export interface ResultReport {
  total?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  rows?: ResultRow[];
}

/**
 * Appends Status/Reason columns to `sheetName` and adds a Results summary sheet.
 * Ported from features/bulk-update/frontend-pages/app.js — same algorithm, typed.
 */
export function buildAnnotatedWorkbook(
  buffer: ArrayBuffer,
  sheetName: string,
  report: ResultReport,
): XLSX.WorkBook {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in workbook.`);

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  const lastCol = range.e.c;

  const rowMap: Record<number, ResultRow> = {};
  (report.rows ?? []).forEach((r) => {
    rowMap[r.row] = r;
  });

  const statusColIdx = lastCol + 1;
  const reasonColIdx = lastCol + 2;
  const headerRowIdx = range.s.r;

  setCellValue(ws, headerRowIdx, statusColIdx, "Status");
  setCellValue(ws, headerRowIdx, reasonColIdx, "Reason");

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const apiRow = r - range.s.r;
    const rowResult = rowMap[apiRow];
    if (rowResult) {
      setCellValue(ws, r, statusColIdx, rowResult.status);
      setCellValue(ws, r, reasonColIdx, rowResult.reason ?? "");
    }
  }

  range.e.c = reasonColIdx;
  ws["!ref"] = XLSX.utils.encode_range(range);

  const summaryData = [
    ["Metric", "Count"],
    ["total", report.total ?? 0],
    ["succeeded", report.succeeded ?? 0],
    ["failed", report.failed ?? 0],
    ["skipped", report.skipped ?? 0],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Results");

  return wb;
}

function setCellValue(
  ws: XLSX.WorkSheet,
  rowIdx: number,
  colIdx: number,
  value: string | number,
) {
  const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
  ws[addr] =
    typeof value === "number" ? { t: "n", v: value } : { t: "s", v: String(value) };
}
