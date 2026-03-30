"use client";

import { useRef } from "react";
import type { ExportPhase } from "@/lib/types";

interface ToolbarProps {
  onImport: (files: FileList) => void;
  onExport: () => void;
  onClearAll: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number;
  exportPhase: ExportPhase;
  exportProgress: number;
  exportUrl: string | null;
  hasClips: boolean;
}

export default function Toolbar({
  onImport,
  onExport,
  onClearAll,
  onZoomIn,
  onZoomOut,
  zoom,
  exportPhase,
  exportProgress,
  exportUrl,
  hasClips,
}: ToolbarProps) {
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      {/* Logo */}
      <div className="toolbar-logo">
        <div className="toolbar-logo-dot" />
        STORYBOARD
      </div>

      <div className="toolbar-sep" />

      {/* Import */}
      <input
        ref={importRef}
        type="file"
        accept="video/*,audio/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            onImport(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <button
        className="toolbar-btn toolbar-btn-ghost"
        onClick={() => importRef.current?.click()}
        title="Import media files"
      >
        ↑ Import
      </button>

      <div className="toolbar-sep" />

      {/* Zoom */}
      <div className="toolbar-zoom">
        <button className="toolbar-zoom-btn" onClick={onZoomOut} title="Zoom out">−</button>
        <span>{Math.round(zoom)}px/s</span>
        <button className="toolbar-zoom-btn" onClick={onZoomIn} title="Zoom in">+</button>
      </div>

      <div className="toolbar-spacer" />

      {/* Export controls */}
      {exportPhase === "idle" && (
        <button
          className="toolbar-btn toolbar-btn-primary"
          onClick={onExport}
          disabled={!hasClips}
          title={hasClips ? "Export video" : "Add clips to timeline first"}
        >
          ⬇ Export
        </button>
      )}

      {exportPhase === "exporting" && (
        <div className="export-progress">
          <div className="export-progress-track">
            <div
              className="export-progress-fill"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
          <span>{exportProgress}%</span>
        </div>
      )}

      {exportPhase === "done" && exportUrl && (
        <div className="export-done-bar">
          <a href={exportUrl} download="edit.mp4" className="download-btn">
            ↓ Download .mp4
          </a>
          <button
            className="toolbar-btn toolbar-btn-ghost"
            onClick={onExport}
          >
            Export again
          </button>
        </div>
      )}

      {exportPhase === "error" && (
        <button className="toolbar-btn toolbar-btn-ghost" onClick={onExport}>
          ↺ Retry export
        </button>
      )}

      {hasClips && exportPhase === "idle" && (
        <>
          <div className="toolbar-sep" />
          <button
            className="toolbar-btn toolbar-btn-danger"
            onClick={onClearAll}
            title="Clear all clips and media"
          >
            ✕ Clear
          </button>
        </>
      )}
    </div>
  );
}
