/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getImportSettings,
  getLastRuns,
  saveImportSettings,
} from "../services/settings.server";
import { formatBytes, useMetrics } from "../lib/useMetrics.js";
import {
  Banner,
  CARDS,
  HelpCard,
  MetricCard,
  Progress,
} from "../components/shared.jsx";
import {
  ClockIcon,
  GearIcon,
  HelpIcon,
  InfoIcon,
  UploadIcon,
} from "../components/icons.jsx";
import { useImport } from "../lib/importer/useImport.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [settings, lastRuns] = await Promise.all([
    getImportSettings(session.shop),
    getLastRuns(session.shop),
  ]);
  return { settings, lastRuns };
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
      <div style={{ maxHeight: "240px", overflowY: "auto" }}>
        <s-unordered-list>
          {items.map((item, i) => (
            <s-list-item key={i}>
              {LABELS[item.type] ?? item.type} · {item.name}:{" "}
              {item.error ?? item.message}
            </s-list-item>
          ))}
        </s-unordered-list>
      </div>
    </s-stack>
  );
}

function DropZone({ disabled, onFiles }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const shopify = useAppBridge();

  const accept = (list) => {
    const all = Array.from(list ?? []);
    const zips = all.filter((f) => /\.zip$/i.test(f.name));
    if (zips.length !== all.length)
      shopify.toast.show("Only .zip files are accepted", { isError: true });
    if (zips.length) onFiles(zips);
  };

  return (
    <>
      <div
        className={`ie-drop${over ? " ie-over" : ""}${disabled ? " ie-disabled" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) accept(e.dataTransfer.files);
        }}
      >
        <div className="ie-drop-ico">
          <UploadIcon />
        </div>
        <h3>Drag &amp; drop your ZIP file here</h3>
        <p>
          or <b>click to select a file</b>
        </p>
        <span className="ie-chip">Accepts .zip files only</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        multiple
        hidden
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

export default function ImportPage() {
  const { settings, lastRuns } = useLoaderData();
  const metrics = useMetrics();
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
  const onFiles = (picked) => {
    setFiles(picked);
    importer.reset();
  };
  const anySelected = TOGGLES.some(([key]) => settings[key]);
  const lastUpdated = Object.values(lastRuns)
    .map((r) => new Date(r.lastRunAt))
    .sort((a, b) => b - a)[0];

  return (
    <div className="ie">
      <s-page heading="MobiMigrate">
        <div className="ie-wrap">
          <div className="ie-title">
            <div className="ie-grow">
              <h1>Import your store data</h1>
              <p className="ie-sub">
                Upload a backup of your Shopify store and migrate it to another
                store with ease.
              </p>
            </div>
            <a
              className="ie-btn"
              href="https://example.com/faq/import"
              target="_blank"
              rel="noreferrer"
            >
              <HelpIcon /> Need help?
            </a>
          </div>

          <section className="ie-card">
            <div className="ie-card-head">
              <div className="ie-grow">
                <h2>Import from ZIP</h2>
                <p className="ie-sub">
                  Upload the ZIP file exported from your Shopify store. If an
                  export was split into several parts, add all of them.
                </p>
              </div>
              <button
                type="button"
                className="ie-btn"
                disabled={importer.running}
                onClick={() => modalRef.current?.showOverlay?.()}
              >
                <GearIcon /> Import settings
              </button>
            </div>

            <DropZone disabled={importer.running} onFiles={onFiles} />

            {files.length > 0 && (
              <ul className="ie-files">
                {files.map((f) => (
                  <li key={f.name}>
                    <span>{f.name}</span>
                    <span>{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="ie-foot">
              <div className="ie-note ie-grow">
                <InfoIcon />
                {anySelected
                  ? "Files are unpacked and uploaded from your browser. Keep this tab open while importing."
                  : "Choose at least one content type in Import settings."}
              </div>
              {importer.running ? (
                <button
                  type="button"
                  className="ie-btn ie-btn-danger"
                  onClick={importer.cancel}
                >
                  Cancel import
                </button>
              ) : (
                <button
                  type="button"
                  className="ie-btn ie-btn-primary"
                  disabled={files.length === 0 || !anySelected}
                  onClick={() => importer.start(files)}
                >
                  <UploadIcon /> {files.length ? "Start import" : "Add file"}
                </button>
              )}
            </div>
          </section>

          {state.status !== "idle" && (
            <section className="ie-card">
              <div className="ie-card-head">
                <h2>Progress</h2>
              </div>
              <div className="ie-status">
                {state.status === "running" && p && (
                  <div>
                    {p.total > 0 ? (
                      <Progress value={Math.round((p.done / p.total) * 100)} />
                    ) : (
                      <Progress />
                    )}
                    <p className="ie-sub" style={{ marginTop: 8, fontSize: 13 }}>
                      {p.phase === "reading"
                        ? "Reading ZIP files…"
                        : `${p.current || "Importing"} · ${p.done.toLocaleString()} of ${p.total.toLocaleString()} items${p.errorCount ? ` · ${p.errorCount} failed` : ""}`}
                    </p>
                  </div>
                )}
                {state.status === "done" && (
                  <Banner
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
                  </Banner>
                )}
                {state.status === "cancelled" && (
                  <Banner tone="warning" heading="Import cancelled">
                    Items imported before cancelling were kept.
                  </Banner>
                )}
                {state.status === "error" && (
                  <Banner tone="critical" heading="Import failed">
                    {state.error}
                  </Banner>
                )}
                {state.result && <Summary result={state.result} />}
              </div>
            </section>
          )}

          <section className="ie-card">
            <div className="ie-card-head">
              <div className="ie-grow">
                <h2>Your store content</h2>
                <p className="ie-sub">
                  This shows what is currently in your store.
                </p>
              </div>
              {lastUpdated && (
                <div className="ie-updated">
                  <ClockIcon />
                  <div>
                    Last exported
                    <br />
                    {lastUpdated.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
            <div className="ie-metrics ie-metrics-3">
              {CARDS.map((card) => (
                <MetricCard
                  key={card.key}
                  card={card}
                  metric={metrics[card.key]}
                  lastRun={lastRuns[card.runType]}
                  showLastRun
                />
              ))}
            </div>
          </section>

          <HelpCard />
        </div>

        <s-modal id="import-settings" heading="Import settings" ref={modalRef}>
          <s-stack gap="base">
            <s-checkbox
              label="Replace existing files with the same name"
              details="When off, files that already exist are skipped."
              checked={form.replaceExisting}
              onChange={(e) =>
                update("replaceExisting", e.currentTarget.checked)
              }
            />
            <s-checkbox
              label="Create missing products as drafts"
              details="Product media is attached to products with the same handle. When a product doesn't exist, create an empty draft (title and handle only) so the images aren't lost."
              checked={form.createMissingProducts}
              onChange={(e) =>
                update("createMissingProducts", e.currentTarget.checked)
              }
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
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
