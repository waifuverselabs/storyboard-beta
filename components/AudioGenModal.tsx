"use client";

import { useState, useRef, useCallback } from "react";
import type { TimelineClip, Track } from "@/lib/types";
import { loadMusicGen, generateMusic, isModelCached } from "@/lib/musicgen";
import type { LoadPhase } from "@/lib/musicgen";
import { formatDuration } from "@/lib/mediaUtils";

const PRESETS = [
  { label: "Cinematic", prompt: "Cinematic orchestral score, dramatic strings and brass, emotional" },
  { label: "Lo-fi", prompt: "Lo-fi hip hop, chill beats, warm vinyl crackle, relaxing" },
  { label: "Ambient", prompt: "Ambient electronic, atmospheric pads, calm and ethereal" },
  { label: "Upbeat", prompt: "Upbeat pop music, energetic rhythm, positive and bright" },
  { label: "Tense", prompt: "Dark dramatic underscore, tense and suspenseful, minimal percussion" },
  { label: "Acoustic", prompt: "Acoustic guitar fingerpicking, warm and nostalgic, gentle" },
];

interface AudioGenModalProps {
  clips: TimelineClip[];
  tracks: Track[];
  totalDuration: number;
  onAdd: (blob: Blob, durationSeconds: number, prompt: string) => void;
  onClose: () => void;
}

export default function AudioGenModal({
  clips,
  tracks,
  totalDuration,
  onAdd,
  onClose,
}: AudioGenModalProps) {
  const videoTracks = tracks.filter((t) => t.kind === "video");
  const videoClips = clips.filter((c) =>
    videoTracks.some((t) => t.id === c.trackId)
  );
  const sceneDuration = Math.min(
    videoClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0) || totalDuration,
    30
  );

  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [targetDur, setTargetDur] = useState(
    Math.min(Math.ceil(sceneDuration), 30)
  );
  const [phase, setPhase] = useState<LoadPhase>({ state: "idle" });
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultDur, setResultDur] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  const isGenerating =
    phase.state === "downloading" ||
    phase.state === "loading" ||
    phase.state === "generating";

  const progressPct = (() => {
    if (phase.state === "downloading") return Math.round(phase.pct * 0.7); // 0-70%
    if (phase.state === "loading") return 72;
    if (phase.state === "generating") {
      return Math.round(75 + (phase.tokensGenerated / phase.maxTokens) * 25);
    }
    return 0;
  })();

  const statusText = (() => {
    if (phase.state === "idle") return isModelCached() ? "Model ready" : "Model not loaded (~183 MB, cached after first use)";
    if (phase.state === "downloading") return `Downloading ${phase.file} — ${phase.pct}%`;
    if (phase.state === "loading") return "Loading model into memory…";
    if (phase.state === "generating")
      return `Generating… ${phase.tokensGenerated} / ${phase.maxTokens} tokens`;
    if (phase.state === "ready") return "Done ✓";
    if (phase.state === "error") return `Error: ${phase.message}`;
    return "";
  })();

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;

    // Clear previous result
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setResultBlob(null);
    setPreviewUrl(null);

    try {
      const { blob, durationSeconds } = await generateMusic({
        prompt,
        durationSeconds: targetDur,
        onPhase: setPhase,
      });

      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setResultBlob(blob);
      setResultDur(durationSeconds);
      setPreviewUrl(url);
    } catch (e) {
      setPhase({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [isGenerating, prompt, targetDur]);

  const handleAdd = () => {
    if (!resultBlob) return;
    onAdd(resultBlob, resultDur, prompt);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-title-icon">✦</span>
            Generate Scene Audio
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Scene info */}
        <div className="modal-scene-info">
          <div className="modal-scene-stat">
            <span className="modal-scene-stat-label">Video clips</span>
            <span className="modal-scene-stat-value">{videoClips.length}</span>
          </div>
          <div className="modal-scene-stat">
            <span className="modal-scene-stat-label">Scene length</span>
            <span className="modal-scene-stat-value">{formatDuration(sceneDuration)}</span>
          </div>
          <div className="modal-scene-stat">
            <span className="modal-scene-stat-label">Generate up to</span>
            <span className="modal-scene-stat-value">30s</span>
          </div>
        </div>

        {/* Prompt */}
        <div className="modal-section">
          <label className="modal-label">Scene description</label>
          <textarea
            className="modal-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="Describe the mood, style, and feel of the music…"
            disabled={isGenerating}
          />
          <div className="modal-presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className={`modal-preset-btn ${prompt === p.prompt ? "active" : ""}`}
                onClick={() => setPrompt(p.prompt)}
                disabled={isGenerating}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="modal-section">
          <div className="modal-label-row">
            <label className="modal-label">Target duration</label>
            <span className="modal-dur-val">{targetDur}s</span>
          </div>
          <input
            type="range"
            min={3}
            max={30}
            step={1}
            value={targetDur}
            onChange={(e) => setTargetDur(parseInt(e.target.value))}
            disabled={isGenerating}
            style={{ width: "100%", accentColor: "#8b5cf6" }}
          />
          <div className="modal-dur-hint">
            {targetDur > sceneDuration
              ? `⚠ Longer than scene (${formatDuration(sceneDuration)}) — music will extend past video`
              : `Matches ${Math.round((targetDur / sceneDuration) * 100)}% of scene`}
          </div>
        </div>

        {/* Progress */}
        {isGenerating && (
          <div className="modal-progress">
            <div className="modal-progress-track">
              <div
                className="modal-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="modal-progress-label">{statusText}</div>
          </div>
        )}

        {/* Status when idle/done/error */}
        {!isGenerating && phase.state !== "idle" && (
          <div
            className={`modal-status ${
              phase.state === "error"
                ? "modal-status-error"
                : phase.state === "ready"
                ? "modal-status-ok"
                : ""
            }`}
          >
            {statusText}
          </div>
        )}

        {/* Preview */}
        {previewUrl && (
          <div className="modal-preview">
            <div className="modal-preview-label">
              Preview — {resultDur.toFixed(1)}s generated
            </div>
            <audio
              src={previewUrl}
              controls
              style={{ width: "100%", height: 36 }}
            />
          </div>
        )}

        {/* Actions */}
        <div className="modal-actions">
          <button
            className="modal-btn-generate"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating
              ? "Generating…"
              : resultBlob
              ? "↺ Regenerate"
              : "✦ Generate"}
          </button>

          {resultBlob && (
            <button className="modal-btn-add" onClick={handleAdd}>
              + Add to A1 Track
            </button>
          )}

          <button className="modal-btn-cancel" onClick={onClose} disabled={isGenerating}>
            Cancel
          </button>
        </div>

        {/* First-use note */}
        {!isModelCached() && phase.state === "idle" && (
          <div className="modal-footnote">
            MusicGen Small (~183 MB) downloads once and is cached in your browser.
            WebGPU accelerated if available (Chrome 113+).
          </div>
        )}
      </div>
    </div>
  );
}
