"use client";

import type { TimelineClip, MediaItem, Track } from "@/lib/types";
import { formatDuration } from "@/lib/mediaUtils";

interface PropertiesPanelProps {
  selectedClip: TimelineClip | null;
  mediaItems: MediaItem[];
  tracks: Track[];
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onDeleteClip: (id: string) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="props-row">
      <span className="props-label">{label}</span>
      <input
        type="range"
        className="props-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="props-value" style={{ minWidth: 36, textAlign: "right" }}>
        {format(value)}
      </span>
    </div>
  );
}

export default function PropertiesPanel({
  selectedClip,
  mediaItems,
  tracks,
  onUpdateClip,
  onDeleteClip,
}: PropertiesPanelProps) {
  const media = selectedClip
    ? mediaItems.find((m) => m.id === selectedClip.mediaId)
    : null;
  const track = selectedClip
    ? tracks.find((t) => t.id === selectedClip.trackId)
    : null;

  return (
    <div className="properties-panel">
      <div className="props-header">Properties</div>

      {!selectedClip ? (
        <div className="props-empty">
          <span style={{ fontSize: 24 }}>☝</span>
          <span>Select a clip</span>
        </div>
      ) : (
        <div className="props-body">
          {/* Clip ID */}
          <div className="props-clip-name">{media?.name ?? "Clip"}</div>
          <div
            className={`props-clip-kind ${
              track?.kind === "video" ? "props-clip-kind-video" : "props-clip-kind-audio"
            }`}
          >
            {track?.kind?.toUpperCase() ?? "CLIP"}
          </div>

          {/* Timing section */}
          <div className="props-section">
            <div className="props-section-label">Timing</div>

            <div className="props-row">
              <span className="props-label">Start</span>
              <span className="props-value">{formatDuration(selectedClip.startTime)}</span>
            </div>

            <div className="props-row">
              <span className="props-label">Duration</span>
              <span className="props-value">{formatDuration(selectedClip.duration)}</span>
            </div>

            <div className="props-row">
              <span className="props-label">Src in</span>
              <span className="props-value">{formatDuration(selectedClip.trimStart)}</span>
            </div>

            <div className="props-row">
              <span className="props-label">Src out</span>
              <span className="props-value">{formatDuration(selectedClip.trimEnd)}</span>
            </div>
          </div>

          {/* Playback section */}
          <div className="props-section">
            <div className="props-section-label">Playback</div>

            <Slider
              label="Volume"
              value={selectedClip.volume}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onUpdateClip(selectedClip.id, { volume: v })}
            />

            <Slider
              label="Speed"
              value={selectedClip.speed}
              min={0.25}
              max={4}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => {
                const sourceDuration = selectedClip.trimEnd - selectedClip.trimStart;
                onUpdateClip(selectedClip.id, {
                  speed: v,
                  duration: sourceDuration / v,
                });
              }}
            />
          </div>

          {/* Transform section — video only */}
          {track?.kind === "video" && (
            <div className="props-section">
              <div className="props-section-label">Transform</div>

              <Slider
                label="Scale"
                value={selectedClip.scale}
                min={0.1}
                max={3}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onUpdateClip(selectedClip.id, { scale: v })}
              />

              <Slider
                label="Opacity"
                value={selectedClip.opacity}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onUpdateClip(selectedClip.id, { opacity: v })}
              />

              <Slider
                label="Pos X"
                value={selectedClip.posX}
                min={-1}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => onUpdateClip(selectedClip.id, { posX: v })}
              />

              <Slider
                label="Pos Y"
                value={selectedClip.posY}
                min={-1}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => onUpdateClip(selectedClip.id, { posY: v })}
              />
            </div>
          )}

          {/* Delete */}
          <button
            className="props-delete-btn"
            onClick={() => onDeleteClip(selectedClip.id)}
          >
            ✕ Remove clip
          </button>
        </div>
      )}
    </div>
  );
}
