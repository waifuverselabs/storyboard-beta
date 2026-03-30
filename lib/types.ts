export type MediaKind = "video" | "audio";

export interface MediaItem {
  id: string;
  name: string;
  file: File;
  url: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  thumbnail: string | null;
}

export interface TimelineClip {
  id: string;
  mediaId: string;
  trackId: string;
  // Position on timeline (seconds)
  startTime: number;
  duration: number;   // visual duration (sourceDuration / speed)
  // Trim into source file (seconds)
  trimStart: number;
  trimEnd: number;
  // Properties
  volume: number;     // 0 – 1
  speed: number;      // 0.25 – 4
  // Video transform
  posX: number;       // fraction of frame width, 0 = center
  posY: number;
  scale: number;      // 1 = fill
  opacity: number;    // 0 – 1
  fadeIn: number;     // seconds
  fadeOut: number;    // seconds
}

export interface Track {
  id: string;
  kind: MediaKind;
  label: string;
  muted: boolean;
  locked: boolean;
  height: number;     // px
}

export type ExportPhase = "idle" | "exporting" | "done" | "error";

export interface LogEntry {
  id: number;
  time: string;
  msg: string;
  kind: "info" | "success" | "error" | "warn";
}
