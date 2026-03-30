"use client";

import { useEffect, useRef } from "react";
import type { LogEntry, ExportPhase } from "@/lib/types";

interface LogFooterProps {
  logs: LogEntry[];
  exportPhase: ExportPhase;
  onClear: () => void;
}

export default function LogFooter({ logs, exportPhase, onClear }: LogFooterProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const indicatorClass =
    exportPhase === "exporting"
      ? "active"
      : exportPhase === "error"
      ? "error"
      : exportPhase === "done"
      ? "done"
      : "";

  return (
    <div className="log-footer">
      <div className="log-header">
        <div className="log-title">
          <div className={`log-indicator ${indicatorClass}`} />
          Console
        </div>
        <span className="log-count">{logs.length} lines</span>
        <div style={{ flex: 1 }} />
        {logs.length > 0 && (
          <button className="log-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div className="log-body">
        {logs.length === 0 ? (
          <div style={{ color: "#2a2a2a", paddingTop: 4 }}>
            › Ready. Import media and drag clips to the timeline.
          </div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="log-line">
              <span className="log-line-time">{entry.time}</span>
              <span className="log-line-prompt">›</span>
              <span className={`log-line-msg log-${entry.kind}`}>{entry.msg}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
