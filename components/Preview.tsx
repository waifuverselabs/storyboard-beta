"use client";

import { useEffect, useRef, useCallback } from "react";
import type { TimelineClip, MediaItem, Track } from "@/lib/types";
import { formatTime } from "@/lib/mediaUtils";

interface PreviewProps {
  clips: TimelineClip[];
  tracks: Track[];
  mediaItems: MediaItem[];
  playhead: number;
  totalDuration: number;
  isPlaying: boolean;
  volume: number;
  onPlayheadChange: (t: number) => void;
  onPlayToggle: () => void;
  onVolumeChange: (v: number) => void;
  onDurationUpdate: (dur: number) => void;
}

function getActiveVideoClip(
  clips: TimelineClip[],
  tracks: Track[],
  t: number
): TimelineClip | null {
  const videoTrackIds = new Set(
    tracks.filter((tr) => tr.kind === "video").map((tr) => tr.id)
  );
  // Prefer earlier starting clip; pick the one covering t
  const candidates = clips.filter(
    (c) =>
      videoTrackIds.has(c.trackId) &&
      c.startTime <= t &&
      c.startTime + c.duration > t
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.startTime <= b.startTime ? a : b));
}

export default function Preview({
  clips,
  tracks,
  mediaItems,
  playhead,
  totalDuration,
  isPlaying,
  volume,
  onPlayheadChange,
  onPlayToggle,
  onVolumeChange,
  onDurationUpdate,
}: PreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentMediaIdRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const lastWallRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  const playheadRef = useRef(playhead);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  // ── Sync video element to playhead ────────────────────────────────────────
  const syncVideo = useCallback(
    (t: number, forceSeek = false) => {
      const v = videoRef.current;
      if (!v) return;
      const clip = getActiveVideoClip(clips, tracks, t);

      if (!clip) {
        v.pause();
        v.src = "";
        currentMediaIdRef.current = null;
        return;
      }

      const media = mediaItems.find((m) => m.id === clip.mediaId);
      if (!media || media.kind !== "video") return;

      // Switch source if needed
      if (currentMediaIdRef.current !== clip.mediaId) {
        v.src = media.url;
        v.load();
        currentMediaIdRef.current = clip.mediaId;
        forceSeek = true;
      }

      const sourceTime =
        clip.trimStart + (t - clip.startTime) * clip.speed;
      const targetTime = Math.max(clip.trimStart, Math.min(clip.trimEnd, sourceTime));

      if (forceSeek || Math.abs(v.currentTime - targetTime) > 0.15) {
        v.currentTime = targetTime;
      }

      v.volume = volume;
      v.playbackRate = clip.speed;
    },
    [clips, tracks, mediaItems, volume]
  );

  // ── RAF-based playback loop ────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      lastWallRef.current = performance.now();
      const tick = () => {
        if (!isPlayingRef.current) return;
        const now = performance.now();
        const dt = (now - lastWallRef.current) / 1000;
        lastWallRef.current = now;

        const newT = Math.min(playheadRef.current + dt, totalDuration);
        onPlayheadChange(newT);
        syncVideo(newT);

        if (newT >= totalDuration) {
          onPlayToggle(); // stop
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync when paused (seeking) ─────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      syncVideo(playhead, false);
    }
  }, [playhead, isPlaying, syncVideo]);

  const activeClip = getActiveVideoClip(clips, tracks, playhead);
  const hasVideo = activeClip !== null;

  return (
    <div className="preview-panel">
      {/* Screen */}
      <div className="preview-screen">
        {hasVideo ? (
          <video
            ref={videoRef}
            className="preview-video"
            playsInline
            muted={volume === 0}
            preload="auto"
          />
        ) : (
          <div className="preview-empty">
            <div className="preview-empty-icon">▶</div>
            <span>No video at playhead</span>
          </div>
        )}
        <div className="preview-time-overlay">
          {formatTime(playhead)} / {formatTime(totalDuration)}
        </div>
      </div>

      {/* Controls */}
      <div className="preview-controls">
        {/* Play / Pause */}
        <button
          className="preview-play-btn"
          onClick={onPlayToggle}
          disabled={totalDuration === 0}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        {/* Seekbar */}
        <input
          type="range"
          className="preview-seek"
          min={0}
          max={totalDuration || 1}
          step={0.01}
          value={playhead}
          onChange={(e) => {
            const t = parseFloat(e.target.value);
            onPlayheadChange(t);
          }}
          style={{
            background: `linear-gradient(to right, #8b5cf6 ${
              totalDuration ? (playhead / totalDuration) * 100 : 0
            }%, #2d2d2d 0%)`,
          }}
        />

        {/* Timecode */}
        <span className="preview-timecode">
          {formatTime(playhead)}
        </span>

        {/* Volume */}
        <div className="preview-vol">
          <span className="preview-vol-icon">
            {volume === 0
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 0 19 10v-2m-5 10v5l-4-4H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            }
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            style={{
              background: `linear-gradient(to right, #39ff14 ${volume * 100}%, #2d2d2d 0%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
