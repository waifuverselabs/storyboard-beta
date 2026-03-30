"use client";

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function loadMediaDuration(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el: HTMLMediaElement =
      kind === "audio" ? new Audio() : document.createElement("video");
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => resolve(isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    setTimeout(() => resolve(0), 8000);
  });
}

export function loadVideoDimensions(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () =>
      resolve({ w: v.videoWidth || 1920, h: v.videoHeight || 1080 });
    v.onerror = () => resolve({ w: 1920, h: 1080 });
    setTimeout(() => resolve({ w: 1920, h: 1080 }), 5000);
  });
}

export function captureThumbnail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.preload = "metadata";
    v.crossOrigin = "anonymous";

    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, v.duration * 0.05 || 0.1);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = 90;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(v, 0, 0, 160, 90);
        resolve(c.toDataURL("image/jpeg", 0.65));
      } catch {
        resolve(null);
      }
    };
    v.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 8000);
  });
}

/** Clamp resolution so neither edge exceeds maxEdge, keeping even numbers */
export function clampResolution(
  w: number,
  h: number,
  maxEdge = 1920
): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const ratio = maxEdge / longest;
  return {
    w: Math.round((w * ratio) / 2) * 2,
    h: Math.round((h * ratio) / 2) * 2,
  };
}
