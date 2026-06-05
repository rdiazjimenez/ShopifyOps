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
import { parseSheetNames } from "../utils/sheet-parser";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function BulkUpdateIndex() {
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(
    async (_: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      // Reset state on every drop
      setSheets([]);
      setSelectedSheet("");
      setError(null);
      setFile(null);
      setFileBuffer(null);

      if (rejectedFiles.length > 0) {
        setError("File rejected. Upload a valid .xlsx file.");
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
        setError(
          e instanceof Error ? e.message : "Unknown error reading file.",
        );
      }
    },
    [],
  );

  const sheetOptions = sheets.map((s) => ({ label: s, value: s }));
  const canSubmit = !!file && !!selectedSheet;

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
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
