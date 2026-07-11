import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { ApiError } from "../api/client";
import {
  downloadLogFile,
  listLogFiles,
  updateLogRetention,
  type LogFileRow,
  type LogType,
} from "../api/logs";

const LOG_TABS: Array<{ type: LogType; label: string; superadminOnly?: boolean }> = [
  { type: "checkout", label: "Checkout / Invoice Creation" },
  { type: "receiving", label: "Receiving" },
  { type: "closing", label: "Invoice Closing Summary" },
  { type: "exceptions", label: "Exceptions", superadminOnly: true },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDays(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function LogsPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const tabs = useMemo(
    () => LOG_TABS.filter((tab) => !tab.superadminOnly || user?.role === "superadmin"),
    [user?.role]
  );
  const [type, setType] = useState<LogType>(tabs[0]?.type ?? "checkout");
  const [files, setFiles] = useState<LogFileRow[]>([]);
  const [retentionDays, setRetentionDays] = useState(10);
  const [draftRetentionDays, setDraftRetentionDays] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!tabs.some((tab) => tab.type === type)) {
      setType(tabs[0]?.type ?? "checkout");
    }
  }, [tabs, type]);

  const scopedShopId = user?.role === "superadmin" ? actingShopId : null;
  const activeTab = tabs.find((tab) => tab.type === type);
  const retentionNeedsShop = user?.role === "superadmin" && type !== "exceptions" && actingShopId === null;

  const reload = useCallback(async () => {
    setError(null);
    setInfo(null);
    try {
      const result = await listLogFiles(type, scopedShopId);
      setFiles(result.files);
      setRetentionDays(result.retention_days);
      setDraftRetentionDays(String(result.retention_days));
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not load log files.");
    }
  }, [scopedShopId, type]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveRetention = async () => {
    const parsed = Number(draftRetentionDays);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
      setError("Retention must be a whole number from 1 to 3650 days.");
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const result = await updateLogRetention(type, parsed, scopedShopId);
      setRetentionDays(result.retention_days);
      setDraftRetentionDays(String(result.retention_days));
      setInfo("Retention saved.");
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not save retention.");
    }
  };

  const download = async (file: LogFileRow) => {
    setError(null);
    try {
      const blob = await downloadLogFile(type, file.filename, scopedShopId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Download failed.");
    }
  };

  return (
    <div className="flex flex-col gap-gutter">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap">
        <div>
          <h1 className="text-headline-lg text-primary">Logs</h1>
          <p className="text-label-md text-on-surface-variant">
            {activeTab?.label ?? "Log files"} · {files.length} files
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-md bg-action px-stack-gap py-2 text-label-md text-on-action"
        >
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Log sections">
        {tabs.map((tab) => (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={type === tab.type}
            onClick={() => setType(tab.type)}
            className={`min-h-touchTarget-sm rounded-md px-stack-gap text-label-md ${
              type === tab.type ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="flex flex-wrap items-end gap-stack-gap">
        <label className="flex flex-col gap-1 text-label-md text-on-surface">
          Retention days
          <input
            value={draftRetentionDays}
            onChange={(e) => setDraftRetentionDays(e.target.value)}
            inputMode="numeric"
            className="min-h-touchTarget-sm w-32 rounded-md border border-outline bg-surface px-3 text-body-md text-on-surface"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveRetention()}
          disabled={retentionNeedsShop}
          className="min-h-touchTarget-sm rounded-md bg-primary px-stack-gap text-label-md text-on-primary disabled:opacity-50"
        >
          Save
        </button>
        <span className="text-label-md text-on-surface-variant">
          Current: {retentionDays} days
        </span>
      </section>

      {retentionNeedsShop && (
        <div role="status" className="rounded-md bg-surface-container px-stack-gap py-3 text-label-md text-on-surface">
          Pick a shop in the sidebar before changing retention for this tab.
        </div>
      )}
      {error && <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">{error}</div>}
      {info && <div role="status" className="rounded-md bg-success px-stack-gap py-3 text-on-secondary">{info}</div>}

      <div className="overflow-x-auto rounded-md border border-outline bg-surface">
        <table className="min-w-full text-left text-label-md">
          <thead className="bg-surface-container text-on-surface-variant">
            <tr>
              <th className="px-stack-gap py-3 font-medium">File</th>
              <th className="px-stack-gap py-3 font-medium">Modified</th>
              <th className="px-stack-gap py-3 font-medium">Size</th>
              <th className="px-stack-gap py-3 font-medium">Age</th>
              <th className="px-stack-gap py-3 font-medium">Expires in</th>
              <th className="px-stack-gap py-3 font-medium">Download</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.relative_path} className="border-t border-outline">
                <td className="px-stack-gap py-3 text-on-surface">
                  <div className="font-medium">{file.filename}</div>
                  <div className="text-label-sm text-on-surface-variant">{file.relative_path}</div>
                </td>
                <td className="px-stack-gap py-3 text-on-surface-variant">
                  {new Date(file.modified_at).toLocaleString()}
                </td>
                <td className="px-stack-gap py-3 text-on-surface-variant">{formatBytes(file.size_bytes)}</td>
                <td className="px-stack-gap py-3 text-on-surface-variant">{formatDays(file.age_days)}</td>
                <td className="px-stack-gap py-3 text-on-surface-variant">
                  {file.expires_in_days === 0 ? "Expires today" : `${file.expires_in_days} days`}
                </td>
                <td className="px-stack-gap py-3">
                  <button
                    type="button"
                    onClick={() => void download(file)}
                    className="rounded-md bg-action px-stack-gap py-2 text-label-md text-on-action"
                  >
                    Download
                  </button>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={6} className="px-stack-gap py-gutter text-center text-on-surface-variant">
                  No log files for this tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
