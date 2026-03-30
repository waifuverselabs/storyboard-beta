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
        style={{
          background: `linear-gradient(to right, #8b5cf6 ${((value - min) / (max - min)) * 100}%, #2d2d2d 0%)`,
        }}
      />
      <span className="props-value" style={{ minWidth: 44, flexShrink: 0, textAlign: "right" }}>
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5"><path d="M12 2a7 7 0 0 1 7 7v3l2 3H3l2-3V9a7 7 0 0 1 7-7z"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>
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
                label="Fade in"
                value={selectedClip.fadeIn ?? 0}
                min={0}
                max={Math.min(selectedClip.duration / 2, 5)}
                step={0.1}
                format={(v) => v === 0 ? "off" : `${v.toFixed(1)}s`}
                onChange={(v) => onUpdateClip(selectedClip.id, { fadeIn: v })}
              />

              <Slider
                label="Fade out"
                value={selectedClip.fadeOut ?? 0}
                min={0}
                max={Math.min(selectedClip.duration / 2, 5)}
                step={0.1}
                format={(v) => v === 0 ? "off" : `${v.toFixed(1)}s`}
                onChange={(v) => onUpdateClip(selectedClip.id, { fadeOut: v })}
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
