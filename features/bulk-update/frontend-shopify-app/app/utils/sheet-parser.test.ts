import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSheetNames } from "./sheet-parser";

function buildWorkbookBuffer(sheetNames: string[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const name of sheetNames) {
    const ws = XLSX.utils.aoa_to_sheet([["col"]]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseSheetNames", () => {
  it("returns sheet names from a valid workbook", () => {
    const buf = buildWorkbookBuffer(["Sheet1", "Sheet2", "Data"]);
    expect(parseSheetNames(buf)).toEqual(["Sheet1", "Sheet2", "Data"]);
  });

  it("returns a single sheet name", () => {
    const buf = buildWorkbookBuffer(["Only"]);
    expect(parseSheetNames(buf)).toEqual(["Only"]);
  });

  it("throws a readable error for an invalid buffer", () => {
    // XLSX.read silently parses garbage — the guard is on empty SheetNames
    const invalid = new TextEncoder().encode("not an xlsx file").buffer;
    expect(() => parseSheetNames(invalid)).toThrow(/Could not parse workbook/);
  });

  it("throws a readable error for an empty ArrayBuffer", () => {
    const empty = new ArrayBuffer(0);
    expect(() => parseSheetNames(empty)).toThrow(/Could not parse workbook/);
  });
});
