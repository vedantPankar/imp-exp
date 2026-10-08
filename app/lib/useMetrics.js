import { useEffect, useState } from "react";

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  return `${(bytes / 1000 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function getJson(url) {
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

// Files and product media have no aggregate in the API, so we page through them in
// chunks and update the card as we go. Cancelled via `signal.aborted` on unmount.
async function scanInChunks(metric, onProgress, signal) {
  let cursor = null;
  let count = 0;
  let bytes = 0;
  for (;;) {
    const qs = new URLSearchParams({ metric });
    if (cursor) qs.set("cursor", cursor);
    const part = await getJson(`/api/metrics?${qs}`);
    if (signal.aborted) return;
    count += part.count;
    bytes += part.bytes ?? 0;
    cursor = part.cursor;
    onProgress({ count, bytes, partial: !part.done });
    if (part.done) return;
  }
}

export function useMetrics() {
  const [metrics, setMetrics] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const patch = (key, value) =>
      setMetrics((m) => ({ ...m, [key]: { ...m[key], ...value } }));
    const failed = (keys) => (error) => {
      if (!signal.aborted)
        keys.forEach((k) => patch(k, { error: error.message, partial: false }));
    };

    getJson("/api/metrics?metric=quick")
      .then((q) => {
        if (signal.aborted) return;
        for (const k of ["articles", "blogs", "pages", "menus"])
          patch(k, { count: q[k] });
      })
      .catch(failed(["articles", "blogs", "pages", "menus"]));
    scanInChunks("files", (v) => patch("files", v), signal).catch(
      failed(["files"]),
    );
    scanInChunks("productMedia", (v) => patch("productMedia", v), signal).catch(
      failed(["productMedia"]),
    );
    return () => controller.abort();
  }, []);
  return metrics;
}
