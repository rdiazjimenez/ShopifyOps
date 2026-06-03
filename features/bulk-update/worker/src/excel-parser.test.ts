import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { parseExcel, ParsedRow } from "./excel-parser";

// ---------------------------------------------------------------------------
// Helpers to build minimal in-memory workbooks
// ---------------------------------------------------------------------------

function buildWorkbook(
  sheetName: string,
  rows: Record<string, string | number | undefined>[]
): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return buf;
}

// ---------------------------------------------------------------------------
// Happy-path tests using the real Matrixify fixture file
// ---------------------------------------------------------------------------

const fixturePath = path.resolve(
  __dirname,
  "../../Matrixify-Import-Demo-Products.xlsx"
);

describe("parseExcel – fixture file (Products sheet)", () => {
  let buffer: ArrayBuffer;

  // Load the file once
  try {
    const nodeBuffer = fs.readFileSync(fixturePath);
    buffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength
    ) as ArrayBuffer;
  } catch {
    // Will cause tests to fail with a clear message
    buffer = new ArrayBuffer(0);
  }

  it("returns an array of ParsedRow", () => {
    const rows = parseExcel(buffer, "Products");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("first row has command MERGE and sku HOPO-101", () => {
    const rows = parseExcel(buffer, "Products");
    const first = rows[0] as Extract<ParsedRow, { skipped: false }>;
    expect(first.skipped).toBe(false);
    expect(first.command).toBe("MERGE");
    expect(first.sku).toBe("HOPO-101");
  });

  it("first row has price, compareAtPrice and cost", () => {
    const rows = parseExcel(buffer, "Products");
    const first = rows[0] as Extract<ParsedRow, { skipped: false }>;
    expect(first.price).toBeDefined();
    expect(first.compareAtPrice).toBeDefined();
    expect(first.cost).toBeDefined();
  });

  it("row numbers start at 1", () => {
    const rows = parseExcel(buffer, "Products");
    expect(rows[0]!.row).toBe(1);
  });

  it("all rows with MERGE command are not skipped", () => {
    const rows = parseExcel(buffer, "Products");
    const notSkipped = rows.filter((r) => !r.skipped);
    expect(notSkipped.length).toBeGreaterThan(0);
    notSkipped.forEach((r) => {
      const nr = r as Extract<ParsedRow, { skipped: false }>;
      expect(nr.command).toBe("MERGE");
    });
  });
});

// ---------------------------------------------------------------------------
// Sheet-not-found error
// ---------------------------------------------------------------------------

describe("parseExcel – sheet not found", () => {
  it("throws descriptive error when sheet name is wrong", () => {
    const buf = buildWorkbook("Sheet1", [{ Command: "UPDATE", Handle: "foo" }]);
    expect(() => parseExcel(buf, "NonExistent")).toThrow(
      "Sheet not found: NonExistent"
    );
  });
});

// ---------------------------------------------------------------------------
// Missing / blank Command → SkippedRow
// ---------------------------------------------------------------------------

describe("parseExcel – missing command", () => {
  it("returns SkippedRow with 'missing command' when Command cell is empty", () => {
    const buf = buildWorkbook("Sheet1", [
      { Handle: "foo", "Variant Price": "9.99" },
    ]);
    const rows = parseExcel(buf, "Sheet1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.skipped).toBe(true);
    expect((rows[0] as { reason: string }).reason).toBe("missing command");
  });

  it("returns SkippedRow when Command is blank string", () => {
    const buf = buildWorkbook("Sheet1", [{ Command: "", Handle: "foo" }]);
    const rows = parseExcel(buf, "Sheet1");
    expect(rows[0]!.skipped).toBe(true);
    expect((rows[0] as { reason: string }).reason).toBe("missing command");
  });
});

// ---------------------------------------------------------------------------
// Unsupported commands
// ---------------------------------------------------------------------------

const UNSUPPORTED = ["NEW", "DELETE", "REPLACE", "IGNORE"];

describe("parseExcel – unsupported commands", () => {
  UNSUPPORTED.forEach((cmd) => {
    it(`returns SkippedRow with reason for command: ${cmd}`, () => {
      const buf = buildWorkbook("Sheet1", [{ Command: cmd, Handle: "foo" }]);
      const rows = parseExcel(buf, "Sheet1");
      expect(rows[0]!.skipped).toBe(true);
      expect((rows[0] as { reason: string }).reason).toBe(
        `unsupported command: ${cmd}`
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Empty cells omitted
// ---------------------------------------------------------------------------

describe("parseExcel – empty cells omitted", () => {
  it("omits price field when cell is empty", () => {
    const buf = buildWorkbook("Sheet1", [
      { Command: "UPDATE", Handle: "my-handle", "Variant Price": undefined },
    ]);
    const rows = parseExcel(buf, "Sheet1");
    const row = rows[0] as Extract<ParsedRow, { skipped: false }>;
    expect(row.skipped).toBe(false);
    expect("price" in row).toBe(false);
  });

  it("includes handle when present", () => {
    const buf = buildWorkbook("Sheet1", [
      { Command: "UPDATE", Handle: "my-handle" },
    ]);
    const rows = parseExcel(buf, "Sheet1");
    const row = rows[0] as Extract<ParsedRow, { skipped: false }>;
    expect(row.handle).toBe("my-handle");
  });

  it("does not include sku when absent from sheet", () => {
    const buf = buildWorkbook("Sheet1", [{ Command: "UPDATE", Handle: "h" }]);
    const rows = parseExcel(buf, "Sheet1");
    const row = rows[0] as Extract<ParsedRow, { skipped: false }>;
    expect("sku" in row).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple rows mixed
// ---------------------------------------------------------------------------

describe("parseExcel – mixed rows", () => {
  it("processes multiple rows correctly", () => {
    const buf = buildWorkbook("Sheet1", [
      { Command: "UPDATE", Handle: "a", "Variant Price": "10.00" },
      { Command: "DELETE", Handle: "b" },
      { Handle: "c" },
      { Command: "MERGE", "Variant SKU": "SKU-1", "Variant Cost": "5.00" },
    ]);
    const rows = parseExcel(buf, "Sheet1");
    expect(rows.length).toBe(4);

    const r0 = rows[0] as Extract<ParsedRow, { skipped: false }>;
    expect(r0.skipped).toBe(false);
    expect(r0.command).toBe("UPDATE");
    expect(r0.row).toBe(1);
    expect(r0.price).toBe("10.00");

    const r1 = rows[1]!;
    expect(r1.skipped).toBe(true);
    expect(r1.row).toBe(2);

    const r2 = rows[2]!;
    expect(r2.skipped).toBe(true);
    expect((r2 as { reason: string }).reason).toBe("missing command");

    const r3 = rows[3] as Extract<ParsedRow, { skipped: false }>;
    expect(r3.skipped).toBe(false);
    expect(r3.command).toBe("MERGE");
    expect(r3.sku).toBe("SKU-1");
    expect(r3.cost).toBe("5.00");
  });
});
