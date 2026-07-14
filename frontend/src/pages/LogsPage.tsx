import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Download, Save } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { AppTabButton } from "../components/AppTabs";
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
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
            <FileText className="h-6 w-6 text-action" /> Logs
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {activeTab?.label ?? "Log files"} <span className="mx-2 text-slate-300">·</span> {files.length} files
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
        >
          <RefreshCw className="h-4 w-4 text-slate-400 transition-transform duration-300 group-hover:rotate-180" />
          <span className="ml-2">Refresh</span>
        </button>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200/60 pb-4" role="tablist" aria-label="Log sections">
        {tabs.map((tab) => (
          <AppTabButton
            key={tab.type}
            role="tab"
            aria-selected={type === tab.type}
            onClick={() => setType(tab.type)}
            active={type === tab.type}
          >
            {tab.label}
          </AppTabButton>
        ))}
      </div>

      <section className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Retention days
            <input
              value={draftRetentionDays}
              onChange={(e) => setDraftRetentionDays(e.target.value)}
              inputMode="numeric"
              className="h-11 w-32 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus:border-action focus:ring-1 focus:ring-action"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveRetention()}
            disabled={retentionNeedsShop}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> Save
          </button>
          <div className="mb-3 text-sm font-medium text-slate-500">
            Current: <span className="font-semibold text-slate-700">{retentionDays}</span> days
          </div>
        </div>

        {retentionNeedsShop && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
            Pick a shop in the sidebar before changing retention for this tab.
          </div>
        )}
        {error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">{error}</div>}
        {info && <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600 ring-1 ring-emerald-200">{info}</div>}
      </section>

      <div className="max-h-[calc(100vh-22rem)] overflow-y-auto rounded-xl border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl custom-scrollbar">
        <table className="app-list-table">
          <thead className="sticky top-0 z-10 bg-slate-50/90 text-[11px] uppercase tracking-widest text-slate-500 backdrop-blur-sm">
            <tr>
              <th className="px-6 py-4 font-semibold">File</th>
              <th className="px-6 py-4 font-semibold">Modified</th>
              <th className="px-6 py-4 font-semibold">Size</th>
              <th className="px-6 py-4 font-semibold">Age</th>
              <th className="px-6 py-4 font-semibold">Expires in</th>
              <th className="px-6 py-4 font-semibold text-right">Download</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {files.map((file) => (
              <tr key={file.relative_path} className="transition-colors hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <div className="font-medium text-slate-900">{file.filename}</div>
                  <div className="mt-1 text-xs text-slate-500">{file.relative_path}</div>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  {new Date(file.modified_at).toLocaleString()}
                </td>
                <td className="px-6 py-4 font-mono text-slate-600">{formatBytes(file.size_bytes)}</td>
                <td className="px-6 py-4 text-slate-600">{formatDays(file.age_days)}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    file.expires_in_days === 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"
                  }`}>
                    {file.expires_in_days === 0 ? "Expires today" : `${file.expires_in_days} days`}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => void download(file)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-xs font-bold tracking-wide text-action shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-sm font-medium text-slate-500">
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
