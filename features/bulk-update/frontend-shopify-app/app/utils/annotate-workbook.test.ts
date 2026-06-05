import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildAnnotatedWorkbook } from "./annotate-workbook";
import type { ResultReport } from "./annotate-workbook";

function makeWorkbookBuffer(sheetName: string, rows: string[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("buildAnnotatedWorkbook", () => {
  it("appends Status and Reason columns to the submitted sheet", () => {
    const buffer = makeWorkbookBuffer("Products", [
      ["Handle", "Title"],
      ["shirt", "Blue Shirt"],
      ["hat", "Red Hat"],
    ]);

    const report: ResultReport = {
      total: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
      rows: [
        { row: 1, lookupKey: "shirt", status: "succeeded", reason: "" },
        { row: 2, lookupKey: "hat", status: "failed", reason: "not found" },
      ],
    };

    const wb = buildAnnotatedWorkbook(buffer, "Products", report);
    const ws = wb.Sheets["Products"];
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

    const header = data[0] as string[];
    expect(header).toContain("Status");
    expect(header).toContain("Reason");

    const row1 = data[1] as string[];
    const statusIdx = header.indexOf("Status");
    const reasonIdx = header.indexOf("Reason");
    expect(row1[statusIdx]).toBe("succeeded");

    const row2 = data[2] as string[];
    expect(row2[statusIdx]).toBe("failed");
    expect(row2[reasonIdx]).toBe("not found");
  });

  it("adds a Results summary sheet with counts", () => {
    const buffer = makeWorkbookBuffer("Data", [
      ["SKU"],
      ["sku-1"],
    ]);

    const report: ResultReport = {
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      rows: [{ row: 1, status: "succeeded" }],
    };

    const wb = buildAnnotatedWorkbook(buffer, "Data", report);
    expect(wb.SheetNames).toContain("Results");

    const summaryData = XLSX.utils.sheet_to_json<string[]>(
      wb.Sheets["Results"],
      { header: 1 },
    );
    expect(summaryData[0]).toEqual(["Metric", "Count"]);
    expect(summaryData[1]).toEqual(["total", 1]);
    expect(summaryData[2]).toEqual(["succeeded", 1]);
    expect(summaryData[3]).toEqual(["failed", 0]);
    expect(summaryData[4]).toEqual(["skipped", 0]);
  });
});
