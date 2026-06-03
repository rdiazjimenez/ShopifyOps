/**
 * Shopify Bulk Update UI — app.js
 *
 * Responsibilities:
 *  1. File picker → parse sheet names with xlsx → populate sheet dropdown
 *  2. Submit → POST multipart/form-data to /api/bulk-update via Pages Function proxy
 *  3. Display Result Report (summary counts + per-row table)
 */

/* ---- State ---- */
/** @type {File|null} */
let selectedFile = null;

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
}

function hideResult() {
  resultSection.hidden = true;
  downloadArea.innerHTML = "";
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
