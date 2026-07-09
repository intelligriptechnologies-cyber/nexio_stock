import { useCallback, useEffect, useState } from "react";
import { useShopScope } from "../auth/ShopScopeProvider";
import { exportLogs, listLogs, type BusinessLogRow, type LogExportFormat, type LogType } from "../api/logs";
import { ApiError } from "../api/client";

const LOG_TYPES: LogType[] = ["invoicing", "stockin", "admin"];

export function LogsPage() {
  const { actingShopId } = useShopScope();
  const [type, setType] = useState<LogType>("invoicing");
  const [rows, setRows] = useState<BusinessLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await listLogs(type, actingShopId);
      setRows(result.logs);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not load logs.");
    }
  }, [actingShopId, type]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const downloadExport = async (format: LogExportFormat) => {
    try {
      const blob = await exportLogs(type, format, actingShopId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-logs.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Export failed.");
    }
  };

  return (
    <div className="flex flex-col gap-gutter">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap">
        <h1 className="text-headline-lg text-primary">Business Logs</h1>
        <div className="flex gap-stack-gap">
          {LOG_TYPES.map((logType) => (
            <button
              key={logType}
              type="button"
              onClick={() => setType(logType)}
              className={`min-h-touchTarget-sm rounded-md px-stack-gap text-label-md ${
                type === logType ? "bg-primary text-on-primary" : "bg-surface-container-high"
              }`}
            >
              {logType}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap gap-stack-gap">
        {(["json", "csv", "txt"] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => void downloadExport(format)}
            className="rounded-md bg-action px-stack-gap py-2 text-label-md text-on-action"
          >
            Export {format.toUpperCase()}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">{error}</div>}

      <ul className="flex flex-col gap-stack-gap">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md bg-surface-container p-stack-gap">
            <div className="flex flex-wrap justify-between gap-stack-gap">
              <span className="text-label-xl text-primary">{row.event_type}</span>
              <span className="text-label-md text-on-surface-variant">{new Date(row.created_at).toLocaleString()}</span>
            </div>
            <div className="text-label-md text-on-surface-variant">
              {row.shop_name ?? row.shop_id ?? "System"} · {row.actor_name ?? row.actor_user_id ?? "System"}
            </div>
            <pre className="mt-stack-gap overflow-x-auto rounded-md bg-surface p-stack-gap text-label-md">
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
