/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getImportSettings,
  saveImportSettings,
} from "../services/settings.server";
import { useImport } from "../lib/importer/useImport.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { settings: await getImportSettings(session.shop) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    settings: await saveImportSettings(session.shop, await request.formData()),
  };
};

const TOGGLES = [
  ["importFiles", "Files"],
  ["importProductMedia", "Product media"],
  ["importBlogPosts", "Blogs and blog posts"],
  ["importPages", "Pages"],
  ["importMenus", "Menus"],
];

const LABELS = {
  files: "Files",
  productMedia: "Product media",
  blogs: "Blogs",
  articles: "Blog posts",
  pages: "Pages",
  menus: "Menus",
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  return `${(bytes / 1000 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function Summary({ result }) {
  const rows = Object.entries(result.summary).filter(([, c]) => c.total > 0);
  return (
    <s-stack gap="base">
      {rows.length === 0 ? (
        <s-banner tone="info">
          Nothing to import for the selected content types.
        </s-banner>
      ) : (
        <s-table>
          <s-table-header-row>
            <s-table-header>Type</s-table-header>
            <s-table-header>Created</s-table-header>
            <s-table-header>Updated / replaced</s-table-header>
            <s-table-header>Skipped</s-table-header>
            <s-table-header>Failed</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map(([type, c]) => (
              <s-table-row key={type}>
                <s-table-cell>{LABELS[type]}</s-table-cell>
                <s-table-cell>{c.created}</s-table-cell>
                <s-table-cell>{c.updated + c.replaced}</s-table-cell>
                <s-table-cell>{c.skipped}</s-table-cell>
                <s-table-cell>{c.failed}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
      <IssueList title="Errors" items={result.errors} />
      <IssueList title="Notes" items={result.warnings} />
    </s-stack>
  );
}

function IssueList({ title, items }) {
  if (!items.length) return null;
  return (
    <s-stack gap="small-300">
      <s-text type="strong">
        {title} ({items.length})
      </s-text>
      <s-box maxBlockSize="240px" overflow="auto">
        <s-unordered-list>
          {items.map((item, i) => (
            <s-list-item key={i}>
              {LABELS[item.type] ?? item.type} · {item.name}:{" "}
              {item.error ?? item.message}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-box>
    </s-stack>
  );
}

export default function ImportPage() {
  const { settings } = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const modalRef = useRef(null);
  const [form, setForm] = useState(settings);
  // Read event values before calling this: currentTarget is null once the handler returns,
  // so it must not be touched inside the state updater.
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const [files, setFiles] = useState([]);
  const importer = useImport({ settings });
  const { state } = importer;
  const p = state.progress;

  useEffect(() => {
    if (fetcher.data?.settings) {
      shopify.toast.show("Import settings saved");
      modalRef.current?.hideOverlay?.();
    }
  }, [fetcher.data, shopify]);

  const save = () =>
    fetcher.submit(
      Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)])),
      {
        method: "POST",
      },
    );
  const onFiles = (event) => {
    setFiles(Array.from(event.currentTarget.files ?? []));
    importer.reset();
  };
  const anySelected = TOGGLES.some(([key]) => settings[key]);

  return (
    <s-page heading="Import">
      <s-banner tone="info" heading="Keep this tab open while importing">
        Files are unpacked and uploaded from your browser. Closing the tab stops
        the import.
      </s-banner>

      <s-section heading="Import from ZIP">
        <s-stack gap="base">
          <s-paragraph>
            Drop the ZIP files created by this app. If an export was split into
            several parts, add all of them.
          </s-paragraph>
          <s-drop-zone
            accept=".zip,application/zip"
            multiple
            label="Drop ZIP files here or click to select"
            disabled={importer.running}
            onChange={onFiles}
            onDropRejected={() =>
              shopify.toast.show("Only .zip files are accepted", {
                isError: true,
              })
            }
          />
          {files.length > 0 && (
            <s-unordered-list>
              {files.map((f) => (
                <s-list-item key={f.name}>
                  {f.name} · {formatBytes(f.size)}
                </s-list-item>
              ))}
            </s-unordered-list>
          )}
          <s-stack direction="inline" gap="base">
            <s-button
              commandFor="import-settings"
              command="--show"
              disabled={importer.running}
            >
              Import settings
            </s-button>
            {importer.running ? (
              <s-button tone="critical" onClick={importer.cancel}>
                Cancel import
              </s-button>
            ) : (
              <s-button
                variant="primary"
                disabled={files.length === 0 || !anySelected}
                onClick={() => importer.start(files)}
              >
                Start import
              </s-button>
            )}
          </s-stack>
          {!anySelected && (
            <s-text color="subdued">
              Choose at least one content type in Import settings.
            </s-text>
          )}
        </s-stack>
      </s-section>

      {state.status !== "idle" && (
        <s-section heading="Progress">
          <s-stack gap="base">
            {state.status === "running" && p && (
              <s-stack gap="small-200">
                {p.total > 0 ? (
                  <s-progress
                    accessibilityLabel="Import progress"
                    value={Math.round((p.done / p.total) * 100)}
                    max="100"
                  />
                ) : (
                  <s-progress accessibilityLabel="Reading ZIP files" />
                )}
                <s-text>
                  {p.phase === "reading"
                    ? "Reading ZIP files…"
                    : `${p.current || "Importing"} · ${p.done.toLocaleString()} of ${p.total.toLocaleString()} items${p.errorCount ? ` · ${p.errorCount} failed` : ""}`}
                </s-text>
              </s-stack>
            )}
            {state.status === "done" && (
              <s-banner
                tone={state.result.errors.length ? "warning" : "success"}
                heading={
                  state.result.errors.length
                    ? "Import finished with errors"
                    : "Import complete"
                }
              >
                {state.result.errors.length
                  ? "Some items could not be imported. See the details below."
                  : "Everything was imported. Files may take a moment to finish processing in Shopify."}
              </s-banner>
            )}
            {state.status === "cancelled" && (
              <s-banner tone="warning" heading="Import cancelled">
                Items imported before cancelling were kept.
              </s-banner>
            )}
            {state.status === "error" && (
              <s-banner tone="critical" heading="Import failed">
                {state.error}
              </s-banner>
            )}
            {state.result && <Summary result={state.result} />}
          </s-stack>
        </s-section>
      )}

      <s-modal id="import-settings" heading="Import settings" ref={modalRef}>
        <s-stack gap="base">
          <s-checkbox
            label="Replace existing files with the same name"
            details="When off, files that already exist are skipped."
            checked={form.replaceExisting}
            onChange={(e) => update("replaceExisting", e.currentTarget.checked)}
          />
          <s-text type="strong">Import these content types</s-text>
          {TOGGLES.map(([key, label]) => (
            <s-checkbox
              key={key}
              label={label}
              checked={form[key]}
              onChange={(e) => update(key, e.currentTarget.checked)}
            />
          ))}
          <s-text color="subdued">
            Blogs, posts, pages and menus are matched by handle: existing ones
            are updated, new ones are created.
          </s-text>
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={save}
          {...(fetcher.state !== "idle" ? { loading: true } : {})}
        >
          Save
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="import-settings"
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
