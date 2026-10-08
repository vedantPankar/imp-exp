/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useExport } from "../lib/exporter/useExport.js";
import { formatBytes, useMetrics } from "../lib/useMetrics.js";
import {
  Banner,
  CARDS,
  HelpCard,
  MetricCard,
  Progress,
} from "../components/shared.jsx";
import {
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  GearIcon,
  StoreIcon,
  UploadIcon,
} from "../components/icons.jsx";
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

const SETTING_TOGGLES = [
  ["includeFiles", "Files"],
  ["includeProductMedia", "Product media"],
  ["includeBlogPosts", "Blog posts"],
  ["includePages", "Pages"],
  ["includeMenus", "Menus"],
];

function ExportStatus({ exporter }) {
  const { state } = exporter;
  const p = state.progress;
  if (state.status === "idle") return null;

  return (
    <div className="ie-status">
      {state.status === "running" && p?.phase === "listing" && (
        <Banner>
          Reading store content… {p.listed.toLocaleString()} items found
          <Progress />
        </Banner>
      )}
      {state.status === "running" && p?.total !== undefined && (
        <Banner heading="Exporting…">
          <Progress value={p.total ? Math.round((p.done / p.total) * 100) : 0} />
          <div style={{ marginTop: 8 }}>
            {p.done.toLocaleString()} of {p.total.toLocaleString()} items · part{" "}
            {p.part} · {formatBytes(p.bytes)}
            {p.failed ? ` · ${p.failed} failed` : ""}
          </div>
        </Banner>
      )}
      {state.status === "completed" && (
        <Banner
          tone={state.failed.length ? "warning" : "success"}
          heading={
            state.failed.length
              ? "Export finished with errors"
              : "Export complete"
          }
        >
          {state.exported.toLocaleString()} items saved in {state.parts} ZIP{" "}
          {state.parts === 1 ? "part" : "parts"}.
          {state.failed.length > 0 &&
            ` ${state.failed.length} could not be downloaded, so this run was not recorded as a complete export.`}
        </Banner>
      )}
      {state.status === "empty" && (
        <Banner>
          There is nothing to export for the selected content types.
        </Banner>
      )}
      {state.status === "cancelled" && (
        <Banner tone="warning" heading="Export cancelled">
          {state.parts
            ? `${state.parts} ZIP part(s) were already downloaded.`
            : "Nothing was downloaded."}
        </Banner>
      )}
      {state.status === "error" && (
        <Banner tone="critical" heading="Export failed">
          {state.error}
        </Banner>
      )}
      {state.skipped?.length > 0 && (
        <Banner>
          {state.skipped.length} external video
          {state.skipped.length === 1 ? "" : "s"} skipped: they are links
          (YouTube/Vimeo), so there is no file to download.
        </Banner>
      )}
      {state.failed.length > 0 && (
        <Banner tone="warning" heading="Failed items">
          <div className="ie-scroll">
            <ul>
              {state.failed.map((f) => (
                <li key={f.name}>
                  {f.name} — {f.error}
                </li>
              ))}
            </ul>
          </div>
        </Banner>
      )}
    </div>
  );
}

function HeroArt() {
  return (
    <div className="ie-art" aria-hidden="true">
      <svg className="ie-art-arrow" viewBox="0 0 60 30" fill="none">
        <path
          d="M2 26C20 4 42 2 58 10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>
      <div className="ie-art-card ie-art-a">
        <h4>Your Shopify Store</h4>
        <ul>
          {["Products", "Customers", "Orders", "Pages", "Blogs & more"].map(
            (t) => (
              <li key={t}>
                <CheckIcon /> {t}
              </li>
            ),
          )}
        </ul>
      </div>
      <div className="ie-art-card ie-art-b">
        <h4>
          <StoreIcon style={{ width: 22, height: 22 }} /> Migrate to another
          store
        </h4>
        <ul>
          {[
            "Keep your data safe",
            "Easy migration",
            "No manual work",
            "Fast and secure",
          ].map((t) => (
            <li key={t}>
              <CheckIcon /> {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Index() {
  const { settings, lastRuns, shop } = useLoaderData();
  const metrics = useMetrics();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const modalRef = useRef(null);
  const [form, setForm] = useState(settings);
  // Read event values before calling this: currentTarget is null once the handler returns,
  // so it must not be touched inside the state updater.
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
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
  const anySelected = SETTING_TOGGLES.some(([key]) => settings[key]);
  const exporter = useExport({ settings, shop, onSuccess: recordRuns });

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

  const exportDisabled = !anySelected || exporter.running;
  const runRows = CARDS.filter((c) => lastRuns[c.runType])
    .map((c) => ({ card: c, at: new Date(lastRuns[c.runType].lastRunAt) }))
    .sort((a, b) => b.at - a.at);

  return (
    <div className="ie">
      <s-page heading="MobiMigrate">
        <div className="ie-wrap">
          <section className="ie-hero">
            <div>
              <h1>Back up or migrate your Shopify store</h1>
              <p className="ie-sub">
                Export your store data as a ZIP file or import it into another
                store — quickly and securely.
              </p>
              <div className="ie-actions">
                <Link to="/app/import" className="ie-btn ie-btn-primary ie-btn-lg">
                  <UploadIcon /> Import store <ArrowRightIcon />
                </Link>
                {exporter.running ? (
                  <button
                    type="button"
                    className="ie-btn ie-btn-danger ie-btn-lg"
                    onClick={exporter.cancel}
                  >
                    Cancel export
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ie-btn ie-btn-outline ie-btn-lg"
                    disabled={exportDisabled}
                    onClick={exporter.start}
                  >
                    <DownloadIcon /> Export store <ChevronRightIcon />
                  </button>
                )}
              </div>
              {!anySelected && (
                <p className="ie-sub" style={{ fontSize: 13, marginTop: 12 }}>
                  Choose at least one content type in Export settings.
                </p>
              )}
            </div>
            <HeroArt />
          </section>

          <Banner heading="Keep this tab open while exporting">
            Exports are built in your browser. Closing or reloading this tab
            before an export finishes will cancel it.
          </Banner>
          <ExportStatus exporter={exporter} />

          <section className="ie-card ie-metrics">
            {CARDS.map((card) => (
              <MetricCard
                key={card.key}
                card={card}
                metric={metrics[card.key]}
              />
            ))}
          </section>

          <div className="ie-cols">
            <section className="ie-card">
              <div className="ie-card-head">
                <div className="ie-ico">
                  <FileIcon />
                </div>
                <div className="ie-grow">
                  <h2>Recent exports</h2>
                  <p className="ie-sub">Last export of each content type</p>
                </div>
              </div>
              <table className="ie-table">
                <thead>
                  <tr>
                    <th>Content</th>
                    <th>Last exported</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ color: "var(--muted)" }}>
                        Nothing has been exported yet.
                      </td>
                    </tr>
                  ) : (
                    runRows.map(({ card, at }) => (
                      <tr key={card.key}>
                        <td>{card.label}</td>
                        <td>{at.toLocaleString()}</td>
                        <td>
                          <span className="ie-pill">Completed</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>

            <section className="ie-card">
              <div className="ie-card-head">
                <div className="ie-ico">
                  <BoltIcon />
                </div>
                <div className="ie-grow">
                  <h2>Quick actions</h2>
                  <p className="ie-sub">Common tasks to get started</p>
                </div>
              </div>
              <div className="ie-actions-col">
                <Link to="/app/import" className="ie-action">
                  <div className="ie-ico">
                    <UploadIcon />
                  </div>
                  <div className="ie-grow">
                    <strong>Import store data</strong>
                    <span className="ie-sub">
                      Upload a ZIP file from your Shopify store.
                    </span>
                  </div>
                  <ChevronRightIcon />
                </Link>
                <button
                  type="button"
                  className="ie-action"
                  disabled={exportDisabled}
                  onClick={exporter.start}
                >
                  <div className="ie-ico">
                    <DownloadIcon />
                  </div>
                  <div className="ie-grow">
                    <strong>Export store data</strong>
                    <span className="ie-sub">
                      Download all your store data as a ZIP file.
                    </span>
                  </div>
                  <ChevronRightIcon />
                </button>
                <button
                  type="button"
                  className="ie-action"
                  disabled={exporter.running}
                  onClick={() => modalRef.current?.showOverlay?.()}
                >
                  <div className="ie-ico">
                    <GearIcon />
                  </div>
                  <div className="ie-grow">
                    <strong>Export settings</strong>
                    <span className="ie-sub">
                      Choose what to include and the ZIP part size.
                    </span>
                  </div>
                  <ChevronRightIcon />
                </button>
              </div>
            </section>
          </div>

          <HelpCard />
        </div>

        <s-modal id="export-settings" heading="Export settings" ref={modalRef}>
          <s-stack gap="base">
            <s-text type="strong">Include in export</s-text>
            {SETTING_TOGGLES.map(([key, label]) => (
              <s-checkbox
                key={key}
                label={label}
                checked={form[key]}
                onChange={(e) => update(key, e.currentTarget.checked)}
              />
            ))}
            <s-number-field
              label="Maximum ZIP part size (MB)"
              min="50"
              max="4000"
              value={String(form.maxPartSizeMb)}
              onInput={(e) => update("maxPartSizeMb", e.currentTarget.value)}
            />
            <s-checkbox
              label="Keep original file names"
              checked={form.keepOriginalNames}
              onChange={(e) =>
                update("keepOriginalNames", e.currentTarget.checked)
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
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
