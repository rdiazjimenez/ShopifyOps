import * as XLSX from "xlsx";

// XLSX files are ZIP archives — magic bytes: PK (0x50 0x4B 0x03 0x04)
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Given an ArrayBuffer of an .xlsx file, returns the list of sheet names.
 * Throws a readable Error if the buffer is not a valid .xlsx file or contains
 * no sheets.
 */
export function parseSheetNames(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < XLSX_MAGIC.length ||
    XLSX_MAGIC.some((b, i) => bytes[i] !== b)
  ) {
    throw new Error(
      "Could not parse workbook: file is not a valid .xlsx file.",
    );
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array" });
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `Could not parse workbook: ${e.message}`
        : "Could not parse workbook: unknown error.",
    );
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("Could not parse workbook: workbook contains no sheets.");
  }
  return wb.SheetNames;
}
