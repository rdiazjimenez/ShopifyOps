import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DropZone,
  Select,
  Button,
  Banner,
  InlineStack,
  Checkbox,
  Spinner,
  DataTable,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { parseSheetNames } from "../utils/sheet-parser";
import { parseExcel } from "../services/bulk-update/excel-parser";
import { runBatch } from "../services/bulk-update/batch-orchestrator";
import {
  InstalledShopifyClient,
  type AdminGraphQL,
} from "../services/bulk-update/shopify-client";
import {
  buildAnnotatedWorkbook,
  type ResultReport,
} from "../utils/annotate-workbook";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const file = formData.get("file") as Blob | null;
  const sheet = formData.get("sheet") as string | null;
  const dryRun = formData.get("dryRun") === "true";

  if (!file) {
    return json({ result: null, error: "No file uploaded." }, { status: 400 });
  }
  if (!sheet) {
    return json({ result: null, error: "No sheet specified." }, { status: 400 });
  }

  let parsedRows;
  try {
    const buffer = await file.arrayBuffer();
    parsedRows = parseExcel(buffer, sheet);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse file.";
    return json({ result: null, error: message }, { status: 400 });
  }

  const client = new InstalledShopifyClient(admin.graphql as AdminGraphQL);

  let report;
  try {
    report = await runBatch(parsedRows, client, dryRun);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bulk update failed.";
    return json({ result: null, error: message }, { status: 500 });
  }

  return json({ result: report as ResultReport, error: null });
};

type SubmitSnapshot = {
  buffer: ArrayBuffer;
  sheet: string;
  fileName: string;
};

const STATUS_TONE: Record<string, "success" | "critical" | "warning" | "info"> =
  {
    succeeded: "success",
    failed: "critical",
    skipped: "warning",
  };

export default function BulkUpdateIndex() {
  const fetcher = useFetcher<typeof action>();

  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);

  // Snapshot of what was submitted — stable reference for download even if user picks a new file.
  const submitSnapshotRef = useRef<SubmitSnapshot | null>(null);

  const isSubmitting = fetcher.state !== "idle";
  const actionError = fetcher.data?.error ?? null;
  const result = fetcher.data?.result ?? null;

  const handleDrop = useCallback(
    async (_: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setSheets([]);
      setSelectedSheet("");
      setUploadError(null);
      setFile(null);
      setFileBuffer(null);

      if (rejectedFiles.length > 0) {
        setUploadError("File rejected. Upload a valid .xlsx file.");
        return;
      }

      const uploaded = acceptedFiles[0];
      if (!uploaded) return;

      try {
        const buffer = await uploaded.arrayBuffer();
        const sheetNames = parseSheetNames(buffer);
        setFile(uploaded);
        setFileBuffer(buffer);
        setSheets(sheetNames);
        setSelectedSheet(sheetNames[0]);
      } catch (e) {
        setUploadError(
          e instanceof Error ? e.message : "Unknown error reading file.",
        );
      }
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!fileBuffer || !selectedSheet || !file) return;
    submitSnapshotRef.current = {
      buffer: fileBuffer,
      sheet: selectedSheet,
      fileName: file.name,
    };
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([fileBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      file.name,
    );
    fd.append("sheet", selectedSheet);
    fd.append("dryRun", dryRun ? "true" : "false");
    fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
  }, [fileBuffer, selectedSheet, file, dryRun, fetcher]);

  const handleDownload = useCallback(() => {
    const snapshot = submitSnapshotRef.current;
    if (!result || !snapshot) return;
    try {
      const wb = buildAnnotatedWorkbook(snapshot.buffer, snapshot.sheet, result);
      const baseName = snapshot.fileName.replace(/\.xlsx$/i, "");
      XLSX.writeFile(wb, `${baseName}_annotated.xlsx`);
    } catch (e) {
      setUploadError(
        e instanceof Error
          ? `Download failed: ${e.message}`
          : "Download failed.",
      );
    }
  }, [result]);

  const sheetOptions = sheets.map((s) => ({ label: s, value: s }));
  const canSubmit = !!file && !!selectedSheet && !isSubmitting;

  const tableRows = (result?.rows ?? []).map((r) => [
    String(r.row),
    r.lookupKey ?? "",
    <Badge tone={STATUS_TONE[r.status] ?? "info"} key={r.row}>
      {r.status}
    </Badge>,
    r.reason ?? "",
  ]);

  return (
    <Page>
      <TitleBar title="Bulk Update" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Bulk Update — File Upload
              </Text>

              {(uploadError || actionError) && (
                <Banner
                  tone="critical"
                  onDismiss={() => setUploadError(null)}
                >
                  {uploadError ?? actionError}
                </Banner>
              )}

              <DropZone
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                type="file"
                allowMultiple={false}
                onDrop={handleDrop}
                label="Upload .xlsx file"
              >
                {file ? (
                  <DropZone.FileUpload actionTitle={`Replace ${file.name}`} />
                ) : (
                  <DropZone.FileUpload actionTitle="Add .xlsx file" />
                )}
              </DropZone>

              {sheets.length > 0 && (
                <Select
                  label="Select sheet"
                  options={sheetOptions}
                  value={selectedSheet}
                  onChange={(v) => setSelectedSheet(v)}
                />
              )}

              <Checkbox
                label="Dry run (preview changes without applying)"
                checked={dryRun}
                onChange={(v) => setDryRun(v)}
              />

              <InlineStack gap="300" blockAlign="center">
                <Button
                  variant="primary"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                >
                  Submit
                </Button>
                {isSubmitting && <Spinner size="small" />}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {result && (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Summary
                  </Text>
                  <InlineStack gap="600">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Total
                      </Text>
                      <Text as="span" variant="headingLg">
                        {String(result.total ?? 0)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Succeeded
                      </Text>
                      <Text as="span" variant="headingLg" tone="success">
                        {String(result.succeeded ?? 0)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Failed
                      </Text>
                      <Text as="span" variant="headingLg" tone="critical">
                        {String(result.failed ?? 0)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Skipped
                      </Text>
                      <Text as="span" variant="headingLg">
                        {String(result.skipped ?? 0)}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Button onClick={handleDownload}>
                    Download annotated workbook
                  </Button>
                </BlockStack>
              </Card>
            </Layout.Section>

            {tableRows.length > 0 && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Row Results
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["Row", "Lookup Key", "Status", "Reason"]}
                      rows={tableRows}
                    />
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}
          </>
        )}
      </Layout>
    </Page>
  );
}
