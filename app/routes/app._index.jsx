/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useFileExport } from "../lib/exporter/useFileExport.js";
import {
  getExportSettings,
  getLastRuns,
  saveExportSettings,
} from "../services/settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [settings, lastRuns] = await Promise.all([
    getExportSettings(session.shop),
    getLastRuns(session.shop),
  ]);
  return { settings, lastRuns, shop: session.shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await saveExportSettings(
    session.shop,
    await request.formData(),
  );
  return { settings };
};

const CARDS = [
  { key: "files", label: "Files", runType: "files" },
  { key: "articles", label: "Blog posts", runType: "articles" },
  { key: "blogs", label: "Blogs", runType: "blogs" },
  { key: "pages", label: "Pages", runType: "pages" },
  { key: "menus", label: "Menus", runType: "menus" },
  {
    key: "productMedia",
    label: "Products with media",
    runType: "productMedia",
  },
];

const SETTING_TOGGLES = [
  ["includeFiles", "Files"],
  ["includeProductMedia", "Product media"],
  ["includeBlogPosts", "Blog posts"],
  ["includePages", "Pages"],
  ["includeMenus", "Menus"],
];

function formatBytes(bytes) {
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

function useMetrics() {
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

function MetricCard({ card, metric, lastRun }) {
  const loading = !metric || (metric.count === undefined && !metric.error);
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{card.label}</s-text>
        {metric?.error ? (
          <s-text tone="critical">Couldn’t load</s-text>
        ) : loading ? (
          <s-spinner accessibilityLabel={`Loading ${card.label}`} size="base" />
        ) : (
          <s-heading>
            {metric.count.toLocaleString()}
            {metric.partial ? "+" : ""}
          </s-heading>
        )}
        {card.key === "files" && metric?.count !== undefined && (
          <s-text color="subdued">{formatBytes(metric.bytes)}</s-text>
        )}
        <s-text color="subdued">
          {lastRun
            ? `Last exported ${new Date(lastRun.lastRunAt).toLocaleString()}`
            : "Never exported"}
        </s-text>
      </s-stack>
    </s-box>
  );
}

function ExportStatus({ exporter }) {
  const { state } = exporter;
  const p = state.progress;
  if (state.status === "idle") return null;

  return (
    <s-stack gap="small-200">
      {state.status === "running" && p?.phase === "listing" && (
        <s-text>Listing files… {p.listed.toLocaleString()} found</s-text>
      )}
      {state.status === "running" && p?.total !== undefined && (
        <>
          <s-progress
            accessibilityLabel="Export progress"
            value={p.total ? Math.round((p.done / p.total) * 100) : 0}
            max="100"
          />
          <s-text>
            {p.done.toLocaleString()} of {p.total.toLocaleString()} files · part{" "}
            {p.part} · {formatBytes(p.bytes)}
            {p.failed ? ` · ${p.failed} failed` : ""}
          </s-text>
        </>
      )}
      {state.status === "completed" && (
        <s-banner
          tone={state.failed.length ? "warning" : "success"}
          heading={
            state.failed.length
              ? "Export finished with errors"
              : "Export complete"
          }
        >
          {state.exported.toLocaleString()} files saved in {state.parts} ZIP{" "}
          {state.parts === 1 ? "part" : "parts"}.
          {state.failed.length > 0 &&
            ` ${state.failed.length} could not be downloaded, so this run was not recorded as a complete export.`}
        </s-banner>
      )}
      {state.status === "empty" && (
        <s-banner tone="info">There are no files to export.</s-banner>
      )}
      {state.status === "cancelled" && (
        <s-banner tone="warning" heading="Export cancelled">
          {state.parts
            ? `${state.parts} ZIP part(s) were already downloaded.`
            : "Nothing was downloaded."}
        </s-banner>
      )}
      {state.status === "error" && (
        <s-banner tone="critical" heading="Export failed">
          {state.error}
        </s-banner>
      )}
      {state.failed.length > 0 && (
        <s-stack gap="small-300">
          <s-text type="strong">Failed files</s-text>
          <s-box maxBlockSize="200px" overflow="auto">
            <s-unordered-list>
              {state.failed.map((f) => (
                <s-list-item key={f.name}>
                  {f.name} — {f.error}
                </s-list-item>
              ))}
            </s-unordered-list>
          </s-box>
        </s-stack>
      )}
    </s-stack>
  );
}

export default function Index() {
  const { settings, lastRuns, shop } = useLoaderData();
  const metrics = useMetrics();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const modalRef = useRef(null);
  const [form, setForm] = useState(settings);
  const saving = fetcher.state !== "idle";
  const revalidator = useRevalidator();

  const recordRuns = useCallback(
    async (runs) => {
      await fetch("/api/export-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs }),
      });
      revalidator.revalidate(); // refresh "Last exported" on the cards
    },
    [revalidator],
  );
  const exporter = useFileExport({ settings, shop, onSuccess: recordRuns });

  useEffect(() => {
    if (fetcher.data?.settings) {
      shopify.toast.show("Export settings saved");
      modalRef.current?.hideOverlay?.();
    }
  }, [fetcher.data, shopify]);

  const save = () =>
    fetcher.submit(
      Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)])),
      { method: "POST" },
    );

  return (
    <s-page heading="Store backup & migration">
      <s-banner tone="info" heading="Keep this tab open while exporting">
        Exports are built in your browser. Closing or reloading this tab before
        an export finishes will cancel it.
      </s-banner>

      <s-section heading="Your store content">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
          gap="base"
        >
          {CARDS.map((card) => (
            <MetricCard
              key={card.key}
              card={card}
              metric={metrics[card.key]}
              lastRun={lastRuns[card.runType]}
            />
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Download files">
        <s-paragraph>
          Export your store content as ZIP archives you can keep as a backup or
          import into another store.
        </s-paragraph>
        <s-stack gap="base">
          <s-stack direction="inline" gap="base">
            <s-button
              commandFor="export-settings"
              command="--show"
              disabled={exporter.running}
            >
              Export settings
            </s-button>
            {exporter.running ? (
              <s-button tone="critical" onClick={exporter.cancel}>
                Cancel export
              </s-button>
            ) : (
              <s-button
                variant="primary"
                disabled={!settings.includeFiles}
                onClick={exporter.start}
              >
                Download
              </s-button>
            )}
          </s-stack>
          {!settings.includeFiles && (
            <s-text color="subdued">
              Turn on “Files” in Export settings to enable downloading.
            </s-text>
          )}
          <ExportStatus exporter={exporter} />
        </s-stack>
      </s-section>

      <s-section heading="Help & FAQ">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://example.com/faq/export" target="_blank">
              How does exporting work?
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="https://example.com/faq/import" target="_blank">
              How do I import into another store?
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="mailto:support@example.com">Contact support</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-modal id="export-settings" heading="Export settings" ref={modalRef}>
        <s-stack gap="base">
          <s-text type="strong">Include in export</s-text>
          {SETTING_TOGGLES.map(([key, label]) => (
            <s-checkbox
              key={key}
              label={label}
              checked={form[key]}
              onChange={(e) =>
                setForm((f) => ({ ...f, [key]: e.currentTarget.checked }))
              }
            />
          ))}
          <s-number-field
            label="Maximum ZIP part size (MB)"
            min="50"
            max="4000"
            value={String(form.maxPartSizeMb)}
            onInput={(e) =>
              setForm((f) => ({ ...f, maxPartSizeMb: e.currentTarget.value }))
            }
          />
          <s-checkbox
            label="Keep original file names"
            checked={form.keepOriginalNames}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                keepOriginalNames: e.currentTarget.checked,
              }))
            }
          />
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={save}
          {...(saving ? { loading: true } : {})}
        >
          Save
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="export-settings"
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
