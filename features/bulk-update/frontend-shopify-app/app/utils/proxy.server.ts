export interface ProxyOptions {
  file: Blob;
  sheet: string;
  dryRun: boolean;
  workerUrl: string;
  apiKey: string;
}

export async function proxyToWorker({
  file,
  sheet,
  dryRun,
  workerUrl,
  apiKey,
}: ProxyOptions): Promise<Response> {
  const url = new URL(workerUrl);
  url.searchParams.set("sheet", sheet);
  if (dryRun) url.searchParams.set("dryRun", "true");

  const fd = new FormData();
  fd.append("file", file, "upload.xlsx");

  return fetch(url.toString(), {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: fd,
  });
}
