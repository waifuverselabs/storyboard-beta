"use client";

import "./editor.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MediaItem,
  TimelineClip,
  Track,
  ExportPhase,
  LogEntry,
  MediaKind,
} from "@/lib/types";
import {
  generateId,
  loadMediaDuration,
  loadVideoDimensions,
  captureThumbnail,
  formatTime,
} from "@/lib/mediaUtils";
import { exportTimeline } from "@/lib/ffmpeg";

import Toolbar from "@/components/Toolbar";
import AudioGenModal from "@/components/AudioGenModal";
import MediaBin from "@/components/MediaBin";
import Preview from "@/components/Preview";
import Timeline from "@/components/Timeline";
import PropertiesPanel from "@/components/PropertiesPanel";
import LogFooter from "@/components/LogFooter";

// ── Default tracks ─────────────────────────────────────────────────────────

const DEFAULT_TRACKS: Track[] = [
  { id: "v1", kind: "video", label: "V1", muted: false, locked: false, height: 76 },
  { id: "a1", kind: "audio", label: "A1", muted: false, locked: false, height: 52 },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLog(msg: string, kind: LogEntry["kind"] = "info"): LogEntry {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
  return { id: Date.now() + Math.random(), time, msg, kind };
}

function getDefaultTrack(tracks: Track[], kind: MediaKind): Track | undefined {
  return tracks.find((t) => t.kind === kind);
}

function getTrackEndTime(clips: TimelineClip[], trackId: string): number {
  return clips
    .filter((c) => c.trackId === trackId)
    .reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Playback
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);

  // Editor
  const [zoom, setZoom] = useState(80); // px/sec
  const [showAudioGen, setShowAudioGen] = useState(false);

  // Export
  const [exportPhase, setExportPhase] = useState<ExportPhase>("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Drag tracking
  const [draggingMediaId, setDraggingMediaId] = useState<string | null>(null);

  // Global drop zone
  const [globalDragOver, setGlobalDragOver] = useState(false);

  const addLog = useCallback((msg: string, kind: LogEntry["kind"] = "info") => {
    setLogs((prev) => [...prev.slice(-199), makeLog(msg, kind)]);
  }, []);

  // ── Total duration ───────────────────────────────────────────────────────

  const totalDuration = clips.reduce(
    (max, c) => Math.max(max, c.startTime + c.duration),
    0
  );

  // ── Import media ─────────────────────────────────────────────────────────

  const importFiles = useCallback(
    async (fileList: FileList) => {
      const files = Array.from(fileList);
      for (const file of files) {
        const isVideo = file.type.startsWith("video/");
        const isAudio = file.type.startsWith("audio/");
        if (!isVideo && !isAudio) {
          addLog(`Skipped ${file.name} — not a video or audio file`, "warn");
          continue;
        }

        addLog(`Importing ${file.name}…`);
        const url = URL.createObjectURL(file);
        const kind: MediaKind = isVideo ? "video" : "audio";
        const duration = await loadMediaDuration(url, kind);
        const { w, h } = isVideo
          ? await loadVideoDimensions(url)
          : { w: 0, h: 0 };
        const thumbnail = isVideo ? await captureThumbnail(url) : null;

        const item: MediaItem = {
          id: generateId(),
          name: file.name,
          file,
          url,
          kind,
          duration,
          width: w,
          height: h,
          thumbnail,
        };

        setMediaItems((prev) => [...prev, item]);
        addLog(`✓ ${file.name} (${duration.toFixed(1)}s)`, "success");
      }
    },
    [addLog]
  );

  // ── Add clip to timeline ──────────────────────────────────────────────────

  const addClipToTimeline = useCallback(
    (item: MediaItem, trackId?: string, startTime?: number) => {
      const targetTrack = trackId
        ? tracks.find((t) => t.id === trackId)
        : getDefaultTrack(tracks, item.kind);

      if (!targetTrack) {
        addLog(`No ${item.kind} track found. Add a track first.`, "warn");
        return;
      }

      // Check if media kind matches track kind
      if (item.kind !== targetTrack.kind) {
        // Try to find a matching track
        const fallback = getDefaultTrack(tracks, item.kind);
        if (!fallback) {
          addLog(`Can't place ${item.kind} on ${targetTrack.kind} track`, "warn");
          return;
        }
      }

      const resolvedTrack =
        item.kind === targetTrack.kind
          ? targetTrack
          : getDefaultTrack(tracks, item.kind) ?? targetTrack;

      const clipStart =
        startTime !== undefined
          ? startTime
          : getTrackEndTime(clips, resolvedTrack.id);

      const clip: TimelineClip = {
        id: generateId(),
        mediaId: item.id,
        trackId: resolvedTrack.id,
        startTime: clipStart,
        duration: item.duration,
        trimStart: 0,
        trimEnd: item.duration,
        volume: 1,
        speed: 1,
        posX: 0,
        posY: 0,
        scale: 1,
        opacity: 1,
      };

      setClips((prev) => [...prev, clip]);
      addLog(`Added "${item.name}" to ${resolvedTrack.label} at ${clipStart.toFixed(1)}s`);
    },
    [tracks, clips, addLog]
  );

  // ── Update / delete clip ──────────────────────────────────────────────────

  const updateClip = useCallback(
    (id: string, patch: Partial<TimelineClip>) => {
      setClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const deleteClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    setSelectedClipId((prev) => (prev === id ? null : prev));
    addLog("Clip removed");
  }, [addLog]);

  // ── Tracks ────────────────────────────────────────────────────────────────

  const addTrack = useCallback(
    (kind: "video" | "audio") => {
      const existing = tracks.filter((t) => t.kind === kind);
      const num = existing.length + 1;
      const prefix = kind === "video" ? "V" : "A";
      setTracks((prev) => [
        ...prev,
        {
          id: generateId(),
          kind,
          label: `${prefix}${num}`,
          muted: false,
          locked: false,
          height: kind === "video" ? 76 : 52,
        },
      ]);
    },
    [tracks]
  );

  const toggleMute = useCallback((trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t))
    );
  }, []);

  // ── Drop on timeline ──────────────────────────────────────────────────────

  const handleDropMedia = useCallback(
    (mediaId: string, trackId: string, startTime: number) => {
      const item = mediaItems.find((m) => m.id === mediaId);
      if (!item) return;
      addClipToTimeline(item, trackId, startTime);
    },
    [mediaItems, addClipToTimeline]
  );

  // ── Playback ──────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (!p && playhead >= totalDuration && totalDuration > 0) {
        setPlayhead(0);
      }
      return !p;
    });
  }, [playhead, totalDuration]);

  // Spacebar to play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        if (selectedClipId && !(e.target instanceof HTMLInputElement)) {
          deleteClip(selectedClipId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, selectedClipId, deleteClip]);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const zoomIn = () => setZoom((z) => Math.min(z * 1.4, 800));
  const zoomOut = () => setZoom((z) => Math.max(z / 1.4, 10));

  // Ctrl+scroll to zoom timeline
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) =>
          e.deltaY < 0
            ? Math.min(z * 1.1, 800)
            : Math.max(z / 1.1, 10)
        );
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (clips.length === 0) {
      addLog("No clips to export.", "warn");
      return;
    }
    if (exportPhase === "exporting") return;

    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl(null);
    setExportPhase("exporting");
    setExportProgress(0);
    addLog("Starting export…");

    try {
      const blob = await exportTimeline({
        clips,
        tracks,
        mediaItems,
        onLog: (msg) => addLog(msg),
        onProgress: (pct) => setExportProgress(pct),
      });

      const url = URL.createObjectURL(blob);
      setExportUrl(url);
      setExportPhase("done");
      addLog(`Export complete — ${(blob.size / 1024 / 1024).toFixed(1)} MB`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Export failed: ${msg}`, "error");
      setExportPhase("error");
    }
  }, [clips, tracks, mediaItems, exportUrl, exportPhase, addLog]);

  // ── AI Audio generation → add to timeline ────────────────────────────────

  const handleAudioGenAdd = useCallback(
    async (blob: Blob, durationSeconds: number, prompt: string, modelName: string) => {
      // Turn the blob into a File so it works with the rest of the pipeline
      const safeName = modelName.replace(/\s+/g, "_").toLowerCase();
      const fileName = `ai_${safeName}_${Date.now()}.wav`;
      const file = new File([blob], fileName, { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      // Find or create an audio track to land on
      const audioTrack = tracks.find((t) => t.kind === "audio") ?? null;
      if (!audioTrack) {
        addLog("No audio track found — add one first.", "warn");
        return;
      }

      const item: MediaItem = {
        id: generateId(),
        name: fileName,
        file,
        url,
        kind: "audio",
        duration: durationSeconds,
        width: 0,
        height: 0,
        thumbnail: null,
      };

      setMediaItems((prev) => [...prev, item]);

      // Place at t=0 on A1, replacing existing audio if track is empty
      const existingEnd = getTrackEndTime(clips, audioTrack.id);
      const startTime = existingEnd > 0 ? existingEnd : 0;

      const clip: TimelineClip = {
        id: generateId(),
        mediaId: item.id,
        trackId: audioTrack.id,
        startTime,
        duration: durationSeconds,
        trimStart: 0,
        trimEnd: durationSeconds,
        volume: 1,
        speed: 1,
        posX: 0,
        posY: 0,
        scale: 1,
        opacity: 1,
      };

      setClips((prev) => [...prev, clip]);
      addLog(`✦ ${modelName} → ${audioTrack.label} — ${durationSeconds.toFixed(1)}s`, "success");
    },
    [tracks, clips, addLog]
  );

  // ── Clear all ─────────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    mediaItems.forEach((m) => URL.revokeObjectURL(m.url));
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setMediaItems([]);
    setClips([]);
    setTracks(DEFAULT_TRACKS);
    setSelectedClipId(null);
    setPlayhead(0);
    setIsPlaying(false);
    setExportPhase("idle");
    setExportProgress(0);
    setExportUrl(null);
    setLogs([]);
    addLog("Cleared all. Ready for new project.");
  }, [mediaItems, exportUrl, addLog]);

  // ── Global drag-over (file drop) ──────────────────────────────────────────

  useEffect(() => {
    const over = (e: DragEvent) => {
      // Only show overlay if dragging files from OS, not internal clips
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setGlobalDragOver(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setGlobalDragOver(false);
    };
    const drop = (e: DragEvent) => {
      setGlobalDragOver(false);
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        importFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [importFiles]);

  // ── Remove media item from bin ─────────────────────────────────────────────

  const removeMediaItem = useCallback(
    (id: string) => {
      const item = mediaItems.find((m) => m.id === id);
      if (item) URL.revokeObjectURL(item.url);
      setMediaItems((prev) => prev.filter((m) => m.id !== id));
      // Remove clips using this media
      setClips((prev) => {
        const removed = prev.filter((c) => c.mediaId === id);
        if (selectedClipId && removed.find((c) => c.id === selectedClipId)) {
          setSelectedClipId(null);
        }
        return prev.filter((c) => c.mediaId !== id);
      });
    },
    [mediaItems, selectedClipId]
  );

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  return (
    <div className="editor">
      {/* Global drop overlay */}
      {globalDragOver && (
        <div className="global-drop-overlay">
          <div className="global-drop-overlay-text">Drop files to import</div>
        </div>
      )}

      {/* AI Audio modal */}
      {showAudioGen && (
        <AudioGenModal
          clips={clips}
          tracks={tracks}
          totalDuration={totalDuration}
          onAdd={handleAudioGenAdd}
          onClose={() => setShowAudioGen(false)}
        />
      )}

      {/* Toolbar */}
      <Toolbar
        onImport={importFiles}
        onExport={handleExport}
        onClearAll={clearAll}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        zoom={zoom}
        exportPhase={exportPhase}
        exportProgress={exportProgress}
        exportUrl={exportUrl}
        hasClips={clips.length > 0}
        onOpenAudioGen={() => setShowAudioGen(true)}
      />

      {/* Main workspace */}
      <div className="workspace">
        {/* Left: Media Bin */}
        <MediaBin
          items={mediaItems}
          onAddToTimeline={addClipToTimeline}
          onRemove={removeMediaItem}
          onImport={importFiles}
          draggingMediaId={draggingMediaId}
          onDragStart={setDraggingMediaId}
          onDragEnd={() => setDraggingMediaId(null)}
        />

        {/* Center: Preview + Timeline */}
        <div className="center-col">
          <Preview
            clips={clips}
            tracks={tracks}
            mediaItems={mediaItems}
            playhead={playhead}
            totalDuration={totalDuration}
            isPlaying={isPlaying}
            volume={volume}
            onPlayheadChange={setPlayhead}
            onPlayToggle={togglePlay}
            onVolumeChange={setVolume}
            onDurationUpdate={() => {}}
          />

          <Timeline
            clips={clips}
            tracks={tracks}
            mediaItems={mediaItems}
            playhead={playhead}
            zoom={zoom}
            selectedClipId={selectedClipId}
            onSeek={(t) => { setPlayhead(t); setIsPlaying(false); }}
            onSelectClip={setSelectedClipId}
            onUpdateClip={updateClip}
            onDeleteClip={deleteClip}
            onDropMedia={handleDropMedia}
            onAddTrack={addTrack}
            onToggleMute={toggleMute}
          />
        </div>

        {/* Right: Properties */}
        <PropertiesPanel
          selectedClip={selectedClip}
          mediaItems={mediaItems}
          tracks={tracks}
          onUpdateClip={updateClip}
          onDeleteClip={deleteClip}
        />
      </div>

      {/* Footer: Log */}
      <LogFooter
        logs={logs}
        exportPhase={exportPhase}
        onClear={() => setLogs([])}
      />
    </div>
  );
}
