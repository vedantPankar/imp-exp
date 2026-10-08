/* eslint-disable react/prop-types */
import { formatBytes } from "../lib/useMetrics.js";
import {
  BookIcon,
  FileIcon,
  HelpIcon,
  ImageIcon,
  ListIcon,
  SupportIcon,
  TagIcon,
} from "./icons.jsx";

export const CARDS = [
  { key: "files", label: "Files", runType: "files", Icon: FileIcon },
  { key: "articles", label: "Blog posts", runType: "articles", Icon: FileIcon },
  { key: "blogs", label: "Blogs", runType: "blogs", Icon: TagIcon },
  { key: "pages", label: "Pages", runType: "pages", Icon: FileIcon },
  { key: "menus", label: "Menus", runType: "menus", Icon: ListIcon },
  {
    key: "productMedia",
    label: "Products with media",
    runType: "productMedia",
    Icon: ImageIcon,
  },
];

export function MetricCard({ card, metric, lastRun, showLastRun }) {
  const loading = !metric || (metric.count === undefined && !metric.error);
  const { Icon } = card;
  return (
    <div className="ie-metric">
      <div className="ie-ico">
        <Icon />
      </div>
      <div className="ie-grow">
        <div className="ie-metric-label">{card.label}</div>
        {metric?.error ? (
          <div className="ie-error">Couldn’t load</div>
        ) : loading ? (
          <div className="ie-metric-value">…</div>
        ) : (
          <div className="ie-metric-value">
            {metric.count.toLocaleString()}
            {metric.partial ? "+" : ""}
          </div>
        )}
        <div className="ie-metric-note">
          {card.key === "files" && metric?.count !== undefined
            ? formatBytes(metric.bytes)
            : "—"}
        </div>
        {showLastRun && (
          <div className="ie-metric-note">
            {lastRun
              ? `Last exported ${new Date(lastRun.lastRunAt).toLocaleString()}`
              : "Never exported"}
          </div>
        )}
      </div>
    </div>
  );
}

export function HelpCard() {
  return (
    <div className="ie-card ie-help">
      <div className="ie-ico">
        <HelpIcon />
      </div>
      <div className="ie-grow" style={{ minWidth: 220 }}>
        <h3 style={{ fontSize: 16 }}>Need help?</h3>
        <p className="ie-sub" style={{ fontSize: 13 }}>
          Find answers to common questions or get in touch with support.
        </p>
      </div>
      <div className="ie-help-links">
        <a
          className="ie-btn"
          href="https://example.com/faq/export"
          target="_blank"
          rel="noreferrer"
        >
          <BookIcon /> How does importing work?
        </a>
        <a
          className="ie-btn"
          href="https://example.com/faq/import"
          target="_blank"
          rel="noreferrer"
        >
          <FileIcon /> How do I import into another store?
        </a>
        <a className="ie-btn" href="mailto:support@example.com">
          <SupportIcon /> Contact support
        </a>
      </div>
    </div>
  );
}

export function Banner({ tone = "info", heading, children }) {
  return (
    <div className={`ie-banner ie-banner-${tone}`}>
      {heading && <strong>{heading}</strong>}
      {children}
    </div>
  );
}

export function Progress({ value }) {
  return value === undefined ? (
    <div className="ie-progress ie-indeterminate">
      <div />
    </div>
  ) : (
    <div className="ie-progress">
      <div style={{ width: `${value}%` }} />
    </div>
  );
}
