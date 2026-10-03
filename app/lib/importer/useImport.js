import { useCallback, useEffect, useRef, useState } from "react";
import { createArchiveSet } from "./zipReader.js";
import { runImport } from "./importer.js";

// Calls /api/import. 429/5xx are marked retriable; other 4xx errors are not.
async function api(intent, payload, signal) {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, ...payload }),
    signal,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(json.error || `HTTP ${response.status}`), {
      retriable: response.status === 429 || response.status >= 500,
    });
  }
  return json;
}

const IDLE = { status: "idle", progress: null, result: null };

export function useImport({ settings }) {
  const [state, setState] = useState(IDLE);
  const controllerRef = useRef(null);
  const running = state.status === "running";

  const start = useCallback(
    async (files) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({
        status: "running",
        progress: { phase: "reading", done: 0, total: 0 },
        result: null,
      });
      try {
        const result = await runImport({
          archives: createArchiveSet(files),
          settings,
          api,
          signal: controller.signal,
          onProgress: (progress) => setState((s) => ({ ...s, progress })),
        });
        setState((s) => ({ ...s, status: result.status, result }));
      } catch (error) {
        setState((s) => ({ ...s, status: "error", error: error.message }));
      }
    },
    [settings],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => setState(IDLE), []);

  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, running, start, cancel, reset };
}
