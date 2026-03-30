"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { TimelineClip, Track, MediaItem } from "@/lib/types";
import { formatTime } from "@/lib/mediaUtils";

interface TimelineProps {
  clips: TimelineClip[];
  tracks: Track[];
  mediaItems: MediaItem[];
  playhead: number;
  zoom: number;          // pixels per second
  selectedClipId: string | null;
  onSeek: (t: number) => void;
  onSelectClip: (id: string | null) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onDeleteClip: (id: string) => void;
  onDropMedia: (mediaId: string, trackId: string, startTime: number) => void;
  onDropFiles: (files: FileList, trackId: string, startTime: number) => void;
  onAddTrack: (kind: "video" | "audio") => void;
  onToggleMute: (trackId: string) => void;
}

type DragState =
  | { type: "move"; clipId: string; startX: number; origStart: number }
  | { type: "trimL"; clipId: string; startX: number; origStart: number; origTrimStart: number; origDuration: number; origTrimEnd: number; speed: number }
  | { type: "trimR"; clipId: string; startX: number; origDuration: number; origTrimEnd: number; speed: number };

const RULER_HEIGHT = 24;
const TRACK_LABEL_W = 64;

function buildRulerMarks(zoom: number, totalWidth: number) {
  // Choose step based on zoom
  const secWidth = zoom; // px per second
  // We want marks every ~5px minimum, labels every ~50px
  let step = 1;
  if (secWidth < 10) step = 10;
  else if (secWidth < 25) step = 5;
  else if (secWidth < 50) step = 2;
  else step = 1;

  const labelEvery = Math.max(1, Math.round(50 / secWidth));
  const count = Math.ceil(totalWidth / secWidth) + 1;
  const marks: { t: number; x: number; label: boolean }[] = [];
  for (let i = 0; i * step * secWidth <= totalWidth + secWidth; i++) {
    const t = i * step;
    const x = t * secWidth;
    marks.push({ t, x, label: i % labelEvery === 0 });
  }
  return marks;
}

export default function Timeline({
  clips,
  tracks,
  mediaItems,
  playhead,
  zoom,
  selectedClipId,
  onSeek,
  onSelectClip,
  onUpdateClip,
  onDeleteClip,
  onDropMedia,
  onDropFiles,
  onAddTrack,
  onToggleMute,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;

  const totalDuration = clips.reduce(
    (max, c) => Math.max(max, c.startTime + c.duration),
    10
  );
  const totalWidth = Math.max(totalDuration * zoom + 400, 800);

  // ── Clip drag handlers ────────────────────────────────────────────────────

  const startDrag = (
    e: React.MouseEvent,
    clip: TimelineClip,
    type: "move" | "trimL" | "trimR"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectClip(clip.id);

    if (type === "move") {
      setDragState({ type: "move", clipId: clip.id, startX: e.clientX, origStart: clip.startTime });
    } else if (type === "trimL") {
      setDragState({
        type: "trimL",
        clipId: clip.id,
        startX: e.clientX,
        origStart: clip.startTime,
        origTrimStart: clip.trimStart,
        origDuration: clip.duration,
        origTrimEnd: clip.trimEnd,
        speed: clip.speed,
      });
    } else {
      setDragState({
        type: "trimR",
        clipId: clip.id,
        startX: e.clientX,
        origDuration: clip.duration,
        origTrimEnd: clip.trimEnd,
        speed: clip.speed,
      });
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const dx = e.clientX - ds.startX;
      const dt = dx / zoom;

      if (ds.type === "move") {
        onUpdateClip(ds.clipId, {
          startTime: Math.max(0, ds.origStart + dt),
        });
      } else if (ds.type === "trimL") {
        const dtSource = dt * ds.speed;
        const newTrimStart = Math.max(0, ds.origTrimStart + dtSource);
        const maxTrimStart = ds.origTrimEnd - 0.1 * ds.speed;
        const clampedTrimStart = Math.min(newTrimStart, maxTrimStart);
        const actualDt = (clampedTrimStart - ds.origTrimStart) / ds.speed;
        onUpdateClip(ds.clipId, {
          startTime: Math.max(0, ds.origStart + actualDt),
          trimStart: clampedTrimStart,
          duration: Math.max(0.1, ds.origDuration - actualDt),
        });
      } else if (ds.type === "trimR") {
        const dtSource = dt * ds.speed;
        const newTrimEnd = ds.origTrimEnd + dtSource;
        const clip = clips.find((c) => c.id === ds.clipId);
        const maxTrimEnd = clip
          ? (() => {
              const media = mediaItems.find((m) => m.id === clip.mediaId);
              return media ? media.duration : ds.origTrimEnd + 60;
            })()
          : ds.origTrimEnd + 60;
        const clampedTrimEnd = Math.min(newTrimEnd, maxTrimEnd);
        const actualDtSource = clampedTrimEnd - ds.origTrimEnd;
        onUpdateClip(ds.clipId, {
          duration: Math.max(0.1, ds.origDuration + actualDtSource / ds.speed),
          trimEnd: clampedTrimEnd,
        });
      }
    };

    const onUp = () => setDragState(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [zoom, onUpdateClip, clips, mediaItems]);

  // ── Ruler click to seek ────────────────────────────────────────────────────

  const onRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) - TRACK_LABEL_W;
    const t = Math.max(0, x / zoom);
    onSeek(t);
  };

  // ── Track drop ────────────────────────────────────────────────────────────

  const onTrackDrop = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling to global page drop handler
    setDragOverTrack(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scrollLeft - TRACK_LABEL_W;
    const startTime = Math.max(0, x / zoom);

    // External file drop — import and place directly
    if (e.dataTransfer.files.length > 0) {
      onDropFiles(e.dataTransfer.files, trackId, startTime);
      return;
    }

    const mediaId = e.dataTransfer.getData("mediaId");
    if (!mediaId) return;
    onDropMedia(mediaId, trackId, startTime);
  };

  const marks = buildRulerMarks(zoom, totalWidth);
  const playheadX = playhead * zoom + TRACK_LABEL_W;

  return (
    <div className="timeline-area">
      {/* Header */}
      <div className="timeline-header">
        <span className="timeline-label">Timeline</span>
        <div style={{ flex: 1 }} />
        <button
          className="timeline-add-track"
          onClick={() => onAddTrack("video")}
          title="Add video track"
        >
          + V
        </button>
        <button
          className="timeline-add-track"
          onClick={() => onAddTrack("audio")}
          title="Add audio track"
        >
          + A
        </button>
      </div>

      {/* Scrollable area */}
      <div
        ref={scrollRef}
        className="timeline-scroll"
        style={{ cursor: dragState ? "grabbing" : "default" }}
      >
        <div style={{ width: totalWidth + TRACK_LABEL_W, position: "relative", minHeight: "100%" }}>

          {/* Ruler */}
          <div
            className="timeline-ruler"
            style={{ paddingLeft: TRACK_LABEL_W }}
            onClick={onRulerClick}
          >
            <div className="timeline-ruler-inner" style={{ width: totalWidth }}>
              {marks.map(({ t, x, label }) => (
                <div key={t}>
                  <div
                    className={`ruler-mark ${label ? "ruler-mark-major" : ""}`}
                    style={{ left: x }}
                  />
                  {label && (
                    <div className="ruler-label" style={{ left: x }}>
                      {formatTime(t)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tracks */}
          <div className="timeline-tracks">
            {tracks.map((track) => {
              const trackClips = clips.filter((c) => c.trackId === track.id);
              const trackHeight = track.height;
              return (
                <div
                  key={track.id}
                  className="timeline-track"
                  style={{ height: trackHeight }}
                >
                  {/* Label */}
                  <div className="track-label" style={{ width: TRACK_LABEL_W }}>
                    <span className="track-label-text">{track.label}</span>
                    <button
                      className={`track-mute-btn ${track.muted ? "muted" : ""}`}
                      onClick={() => onToggleMute(track.id)}
                      title={track.muted ? "Unmute" : "Mute"}
                    >
                      {track.muted ? "M" : "m"}
                    </button>
                  </div>

                  {/* Track body */}
                  <div
                    className={`track-body ${track.kind === "audio" ? "track-body-audio" : ""} track-drop-target ${dragOverTrack === track.id ? "drag-over" : ""}`}
                    style={{ width: totalWidth }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverTrack(track.id);
                    }}
                    onDragLeave={() => setDragOverTrack(null)}
                    onDrop={(e) => onTrackDrop(e, track.id)}
                    onClick={(e) => {
                      // Deselect when clicking empty area
                      if ((e.target as HTMLElement).classList.contains("track-body")) {
                        onSelectClip(null);
                      }
                    }}
                  >
                    {trackClips.map((clip) => {
                      const media = mediaItems.find((m) => m.id === clip.mediaId);
                      const left = clip.startTime * zoom;
                      const width = Math.max(12, clip.duration * zoom);
                      const isSelected = clip.id === selectedClipId;

                      return (
                        <div
                          key={clip.id}
                          className={`clip ${track.kind === "video" ? "clip-video" : "clip-audio"} ${isSelected ? "selected" : ""}`}
                          style={{ left, width }}
                          onMouseDown={(e) => startDrag(e, clip, "move")}
                          onDoubleClick={() => onDeleteClip(clip.id)}
                          title={`${media?.name ?? "clip"} · double-click to delete`}
                        >
                          {/* Left trim handle */}
                          <div
                            className="clip-trim-handle clip-trim-handle-l"
                            onMouseDown={(e) => startDrag(e, clip, "trimL")}
                          >
                            <div className="clip-trim-handle-pip" />
                          </div>

                          {/* Content */}
                          <div className="clip-inner">
                            <span className="clip-label">
                              {media?.name ?? "clip"}
                            </span>
                          </div>

                          {/* Right trim handle */}
                          <div
                            className="clip-trim-handle clip-trim-handle-r"
                            onMouseDown={(e) => startDrag(e, clip, "trimR")}
                          >
                            <div className="clip-trim-handle-pip" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Playhead */}
          <div
            className="playhead"
            style={{
              left: playheadX,
              top: RULER_HEIGHT,
              bottom: 0,
              position: "absolute",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}
