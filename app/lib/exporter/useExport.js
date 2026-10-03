import { useCallback, useEffect, useRef, useState } from "react";
import { collectExportData } from "./collect.js";
import { createDownloader } from "./fetchWithProxy.js";
import { createPlanner } from "./plan.js";
import { exportItems } from "./zipExporter.js";

const sumSize = (list) => list.reduce((n, f) => n + (f.size ?? 0), 0);

const IDLE = { status: "idle", progress: null, failed: [], parts: 0 };

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
 * Drives an export from the browser. `onSuccess(runs)` is called only when the run
 * finished without cancellation or failed files.
 */
export function useExport({ settings, shop, onSuccess }) {
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
    const prefix = `${shop.replace(".myshopify.com", "")}-export-${stamp}`;

    try {
      const data = await collectExportData({
        settings,
        signal: controller.signal,
        onProgress: (progress) => setState((s) => ({ ...s, progress })),
      });

      // JSON content goes first so it all lands in part 1 next to its manifest.
      const planner = createPlanner({
        keepOriginalNames: settings.keepOriginalNames,
      });
      const items = [
        ...planner.contentItems(data),
        ...planner.fileItems(data.files),
        ...planner.productMediaItems(data.productMedia),
      ];

      const result = await exportItems({
        items,
        fetchFn: createDownloader(),
        maxPartBytes: settings.maxPartSizeMb * 1_000_000,
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
        const runs = [
          settings.includeFiles && {
            type: "files",
            itemCount: data.files.length,
            totalBytes: sumSize(data.files),
          },
          settings.includeProductMedia && {
            type: "productMedia",
            itemCount: new Set(data.productMedia.map((m) => m.productHandle))
              .size,
            totalBytes: sumSize(data.productMedia),
          },
          settings.includeBlogPosts && {
            type: "blogs",
            itemCount: data.blogs.length,
          },
          settings.includeBlogPosts && {
            type: "articles",
            itemCount: data.articles.length,
          },
          settings.includePages && {
            type: "pages",
            itemCount: data.pages.length,
          },
          settings.includeMenus && {
            type: "menus",
            itemCount: data.menus.length,
          },
        ].filter(Boolean);
        await onSuccess?.(runs);
      }
      setState((s) => ({
        ...s,
        status: result.status,
        failed: result.failed,
        exported,
        skipped: data.skipped,
        parts: result.parts,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        status: error.name === "AbortError" ? "cancelled" : "error",
        error: error.message,
      }));
    }
  }, [settings, shop, onSuccess]);

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
