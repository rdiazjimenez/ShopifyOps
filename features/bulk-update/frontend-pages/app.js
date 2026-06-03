/**
 * Shopify Bulk Update UI — app.js
 *
 * Responsibilities:
 *  1. File picker → parse sheet names with xlsx → populate sheet dropdown
 *  2. Submit → POST multipart/form-data to /api/bulk-update via Pages Function proxy
 *  3. Display Result Report (summary counts + per-row table)
 *  4. "Download annotated workbook" button — client-side xlsx generation
 */

/* ---- State ---- */
/** @type {File|null} */
let selectedFile = null;
/** @type {object|null} Last successful ResultReport from the API */
let lastReport = null;
/** @type {ArrayBuffer|null} Raw bytes of the last uploaded file (for annotation) */
let lastFileBuffer = null;
/** @type {string|null} Sheet name used in the last submission */
let lastSheetName = null;

/* ---- DOM refs ---- */
const fileInput     = /** @type {HTMLInputElement}   */ (document.getElementById("file-input"));
const sheetGroup    = /** @type {HTMLElement}         */ (document.getElementById("sheet-group"));
const sheetSelect   = /** @type {HTMLSelectElement}  */ (document.getElementById("sheet-select"));
const dryRunCheck   = /** @type {HTMLInputElement}   */ (document.getElementById("dry-run"));
const submitBtn     = /** @type {HTMLButtonElement}  */ (document.getElementById("submit-btn"));
const uploadForm    = /** @type {HTMLFormElement}    */ (document.getElementById("upload-form"));
const loadingEl     = /** @type {HTMLElement}         */ (document.getElementById("loading"));
const errorBanner   = /** @type {HTMLElement}         */ (document.getElementById("error-banner"));
const resultSection = /** @type {HTMLElement}         */ (document.getElementById("result-section"));
const countTotal    = /** @type {HTMLElement}         */ (document.getElementById("count-total"));
const countSucceeded= /** @type {HTMLElement}         */ (document.getElementById("count-succeeded"));
const countFailed   = /** @type {HTMLElement}         */ (document.getElementById("count-failed"));
const countSkipped  = /** @type {HTMLElement}         */ (document.getElementById("count-skipped"));
const rowsTbody     = /** @type {HTMLElement}         */ (document.getElementById("rows-tbody"));
const downloadArea  = /** @type {HTMLElement}         */ (document.getElementById("download-area"));

/* =========================================================
   1. File picker → parse sheets
   ========================================================= */
fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    selectedFile = null;
    hideSheetDropdown();
    submitBtn.disabled = true;
    return;
  }

  selectedFile = file;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    populateSheets(workbook.SheetNames);
  } catch (err) {
    showError("Could not read workbook: " + (err.message || String(err)));
    hideSheetDropdown();
    submitBtn.disabled = true;
    return;
  }

  hideError();
  submitBtn.disabled = false;
});

function populateSheets(sheetNames) {
  sheetSelect.innerHTML = "";
  sheetNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sheetSelect.appendChild(opt);
  });
  sheetGroup.hidden = false;
}

function hideSheetDropdown() {
  sheetGroup.hidden = true;
  sheetSelect.innerHTML = "";
}

/* =========================================================
   2. Form submit → proxy POST
   ========================================================= */
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedFile) return;

  const sheet   = sheetSelect.value;
  const dryRun  = dryRunCheck.checked;

  hideError();
  hideResult();
  setLoading(true);
  submitBtn.disabled = true;

  const formData = new FormData();
  formData.append("file", selectedFile, selectedFile.name);

  const params = new URLSearchParams({ sheet });
  if (dryRun) params.set("dryRun", "true");
  const url = `/api/bulk-update?${params}`;

  let response;
  try {
    response = await fetch(url, { method: "POST", body: formData });
  } catch (err) {
    setLoading(false);
    submitBtn.disabled = false;
    showError("Network error: " + (err.message || String(err)));
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    setLoading(false);
    submitBtn.disabled = false;
    showError(`Server returned a non-JSON response (HTTP ${response.status}).`);
    return;
  }

  setLoading(false);
  submitBtn.disabled = false;

  if (!response.ok) {
    const msg = data.error || JSON.stringify(data);
    showError(`Error (HTTP ${response.status}): ${msg}`);
    return;
  }

  // Store state for annotated workbook download.
  lastReport    = data;
  lastSheetName = sheet;
  // Re-read buffer asynchronously; download button guarded by lastFileBuffer check.
  selectedFile.arrayBuffer().then((buf) => { lastFileBuffer = buf; });

  showResult(data);
});

/* =========================================================
   3. Result display
   ========================================================= */
function showResult(report) {
  countTotal.textContent     = String(report.total     ?? 0);
  countSucceeded.textContent = String(report.succeeded ?? 0);
  countFailed.textContent    = String(report.failed    ?? 0);
  countSkipped.textContent   = String(report.skipped   ?? 0);

  rowsTbody.innerHTML = "";
  (report.rows || []).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escHtml(String(row.row))}</td>
      <td>${escHtml(String(row.lookupKey ?? ""))}</td>
      <td class="status-${escHtml(row.status)}">${escHtml(row.status)}</td>
      <td>${escHtml(row.reason ?? "")}</td>
    `;
    rowsTbody.appendChild(tr);
  });

  resultSection.hidden = false;

  // Show download button once result is rendered.
  renderDownloadButton();
}

function hideResult() {
  resultSection.hidden = true;
  downloadArea.innerHTML = "";
  lastReport = null;
  lastFileBuffer = null;
  lastSheetName = null;
}

/* =========================================================
   4. Annotated workbook download
   ========================================================= */
function renderDownloadButton() {
  downloadArea.innerHTML = "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Download annotated workbook";
  btn.addEventListener("click", handleDownload);
  downloadArea.appendChild(btn);
}

async function handleDownload() {
  // Ensure buffer is ready (arrayBuffer() resolves quickly after submit).
  if (!lastReport || !lastSheetName) return;

  // If buffer isn't ready yet, wait briefly.
  if (!lastFileBuffer) {
    lastFileBuffer = await selectedFile.arrayBuffer();
  }

  try {
    const workbook = XLSX.read(lastFileBuffer, { type: "array" });

    /* ---- Annotate the original sheet ---- */
    const ws = workbook.Sheets[lastSheetName];
    if (!ws) throw new Error(`Sheet "${lastSheetName}" not found in workbook.`);

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const lastCol = range.e.c;

    // Map: row number (1-based data row as returned by API) → { status, reason }
    const rowMap = {};
    (lastReport.rows || []).forEach((r) => { rowMap[r.row] = r; });

    const statusColIdx = lastCol + 1;
    const reasonColIdx = lastCol + 2;
    const headerRowIdx = range.s.r; // 0-based index of the header row

    setCellValue(ws, headerRowIdx, statusColIdx, "Status");
    setCellValue(ws, headerRowIdx, reasonColIdx, "Reason");

    // Data rows start one below the header.
    // API `row` is 1-based relative to the first data row (i.e. row 1 = headerRowIdx+1).
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const apiRow = r - range.s.r; // 1-based
      const result = rowMap[apiRow];
      if (result) {
        setCellValue(ws, r, statusColIdx, result.status);
        setCellValue(ws, r, reasonColIdx, result.reason ?? "");
      }
    }

    // Expand sheet ref to cover new columns.
    range.e.c = reasonColIdx;
    ws["!ref"] = XLSX.utils.encode_range(range);

    /* ---- Results summary sheet ---- */
    const resultsData = [
      ["Metric",    "Count"],
      ["total",     lastReport.total     ?? 0],
      ["succeeded", lastReport.succeeded ?? 0],
      ["failed",    lastReport.failed    ?? 0],
      ["skipped",   lastReport.skipped   ?? 0],
    ];
    const resultWs = XLSX.utils.aoa_to_sheet(resultsData);
    XLSX.utils.book_append_sheet(workbook, resultWs, "Results");

    /* ---- Trigger browser download ---- */
    const baseName = selectedFile
      ? selectedFile.name.replace(/\.xlsx$/i, "")
      : "workbook";
    XLSX.writeFile(workbook, `${baseName}_annotated.xlsx`);
  } catch (err) {
    showError("Failed to generate annotated workbook: " + (err.message || String(err)));
  }
}

/** Write a cell value (string or number) into a worksheet at (rowIdx, colIdx). */
function setCellValue(ws, rowIdx, colIdx, value) {
  const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
  ws[addr] = typeof value === "number"
    ? { t: "n", v: value }
    : { t: "s", v: String(value) };
}

/* =========================================================
   Helpers
   ========================================================= */
function setLoading(active) {
  loadingEl.hidden = !active;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
  errorBanner.textContent = "";
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
