/**
 * PROTOTYPE — throwaway. Answers: does SheetJS work client-side in this
 * Remix+Polaris setup and do DropZone+Select compose cleanly?
 * Delete after issue #45 is shipped.
 */
import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function UploadProto() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(
    async (_: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setSheets([]);
      setSelectedSheet("");
      setError(null);
      setFile(null);

      if (rejectedFiles.length > 0) {
        setError("File rejected. Upload a valid .xlsx file.");
        return;
      }

      const uploaded = acceptedFiles[0];
      if (!uploaded) return;

      try {
        const buffer = await uploaded.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        if (!wb.SheetNames.length) throw new Error("Workbook has no sheets.");
        setFile(uploaded);
        setSheets(wb.SheetNames);
        setSelectedSheet(wb.SheetNames[0]);
      } catch (e) {
        setError(
          e instanceof Error
            ? `Could not read file: ${e.message}`
            : "Unknown error reading file.",
        );
      }
    },
    [],
  );

  const sheetOptions = sheets.map((s) => ({ label: s, value: s }));
  const canSubmit = !!file && !!selectedSheet;

  return (
    <Page>
      <TitleBar title="Upload prototype (throwaway)" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Bulk Update — File Upload
              </Text>

              {error && (
                <Banner tone="critical" onDismiss={() => setError(null)}>
                  {error}
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

              <InlineStack>
                <Button variant="primary" disabled={!canSubmit}>
                  Submit
                </Button>
              </InlineStack>

              {/* State dump for prototype evaluation */}
              <details>
                <summary>
                  <Text as="span" variant="bodySm">
                    State (prototype debug)
                  </Text>
                </summary>
                <pre style={{ fontSize: 12, margin: "8px 0 0" }}>
                  {JSON.stringify(
                    {
                      file: file?.name ?? null,
                      sheets,
                      selectedSheet,
                      canSubmit,
                      error,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
