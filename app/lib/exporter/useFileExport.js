import { useCallback, useEffect, useRef, useState } from "react";
import { collectFiles, exportFiles } from "./zipExporter.js";

const IDLE = { status: "idle", progress: null, failed: [], parts: 0 };

async function fetchFilesPage(cursor, signal) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/files${qs}`, { signal });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

// Browsers only start a download from a link click; the object URL is freed right after.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Drives a file export from the browser. `onSuccess(runs)` is called only when the run
 * finished without cancellation or failed files.
 */
export function useFileExport({ settings, shop, onSuccess }) {
  const [state, setState] = useState(IDLE);
  const controllerRef = useRef(null);
  const running = state.status === "running";

  const start = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({
      ...IDLE,
      status: "running",
      progress: { phase: "listing", listed: 0 },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = `${shop.replace(".myshopify.com", "")}-files-${stamp}`;

    try {
      const files = await collectFiles(
        (cursor) => fetchFilesPage(cursor, controller.signal),
        {
          signal: controller.signal,
          onProgress: (progress) => setState((s) => ({ ...s, progress })),
        },
      );
      const result = await exportFiles({
        files,
        maxPartBytes: settings.maxPartSizeMb * 1_000_000,
        keepOriginalNames: settings.keepOriginalNames,
        signal: controller.signal,
        manifestInfo: { shop },
        onProgress: (progress) => setState((s) => ({ ...s, progress })),
        onPart: async ({ index, blob }) => {
          saveBlob(
            blob,
            `${prefix}-part-${String(index).padStart(2, "0")}.zip`,
          );
          setState((s) => ({ ...s, parts: index }));
        },
      });

      const exported = result.done - result.failed.length;
      if (result.status === "completed" && result.failed.length === 0) {
        await onSuccess?.([
          { type: "files", itemCount: exported, totalBytes: result.bytes },
        ]);
      }
      setState((s) => ({
        ...s,
        status: result.status,
        failed: result.failed,
        exported,
        parts: result.parts,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        status: error.name === "AbortError" ? "cancelled" : "error",
        error: error.message,
      }));
    }
  }, [settings.maxPartSizeMb, settings.keepOriginalNames, shop, onSuccess]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  // Warn before the tab closes mid-export, and abort if the dashboard unmounts.
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, running, start, cancel };
}
