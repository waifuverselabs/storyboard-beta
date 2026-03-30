"use client";

import { useState, useRef, useCallback } from "react";
import type { TimelineClip, Track } from "@/lib/types";
import { AUDIO_MODELS, type AudioModel } from "@/lib/audioModels";
import { generateAudio, isModelLoaded } from "@/lib/musicgen";
import type { LoadPhase } from "@/lib/musicgen";
import { formatDuration } from "@/lib/mediaUtils";

interface AudioGenModalProps {
  clips: TimelineClip[];
  tracks: Track[];
  totalDuration: number;
  onAdd: (blob: Blob, durationSeconds: number, prompt: string, modelName: string, task: string) => void;
  onClose: () => void;
}

export default function AudioGenModal({
  clips,
  tracks,
  totalDuration,
  onAdd,
  onClose,
}: AudioGenModalProps) {
  const defaultModel = AUDIO_MODELS.find((m) => m.defaultSelected) ?? AUDIO_MODELS[0];
  const [selectedModelId, setSelectedModelId] = useState(defaultModel.id);
  const model = AUDIO_MODELS.find((m) => m.id === selectedModelId)!;

  const videoTracks = tracks.filter((t) => t.kind === "video");
  const videoClips = clips.filter((c) =>
    videoTracks.some((t) => t.id === c.trackId)
  );
  const sceneDuration = Math.min(
    videoClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0) ||
      totalDuration,
    model.maxDurationSeconds ?? 30
  );

  const [prompt, setPrompt] = useState(model.prompts[0]);
  const [speed, setSpeed] = useState(model.speed ?? 1);
  const [targetDur, setTargetDur] = useState(Math.min(Math.ceil(sceneDuration), model.maxDurationSeconds ?? 30));
  const [phase, setPhase] = useState<LoadPhase>({ state: "idle" });
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultDur, setResultDur] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  const isGenerating =
    phase.state === "downloading" ||
    phase.state === "loading" ||
    phase.state === "generating";

  // When model switches, reset prompt to that model's first suggestion
  const selectModel = (m: AudioModel) => {
    setSelectedModelId(m.id);
    setPrompt(m.prompts[0]);
    setSpeed(m.speed ?? 1);
    const maxDur = m.maxDurationSeconds ?? 30;
    setTargetDur(Math.min(Math.ceil(sceneDuration), maxDur));
    setResultBlob(null);
    setPreviewUrl(null);
  };

  const progressPct = (() => {
    if (phase.state === "downloading") return Math.round(phase.pct * 0.72);
    if (phase.state === "loading") return 74;
    if (phase.state === "generating") {
      if (phase.maxTokens === 0) return 80;
      return Math.round(76 + (phase.tokensGenerated / phase.maxTokens) * 24);
    }
    return 0;
  })();

  const statusText = (() => {
    if (phase.state === "idle") return isModelLoaded(model.id) ? "Model ready in memory" : `${model.size} — cached after first download`;
    if (phase.state === "downloading") return `↓ ${phase.file}  ${phase.pct}%`;
    if (phase.state === "loading") return "Loading model weights…";
    if (phase.state === "generating") {
      if (model.task === "tts") return "Generating speech…";
      return `Generating…  ${phase.tokensGenerated} / ${phase.maxTokens} tokens`;
    }
    if (phase.state === "ready") return "Done ✓";
    if (phase.state === "error") return `Error: ${phase.message}`;
    return "";
  })();

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    setResultBlob(null);
    setPreviewUrl(null);

    try {
      const { blob, durationSeconds } = await generateAudio({
        model,
        prompt,
        durationSeconds: targetDur,
        speed,
        onPhase: setPhase,
      });

      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setResultBlob(blob);
      setResultDur(durationSeconds);
      setPreviewUrl(url);
    } catch (e) {
      setPhase({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [isGenerating, model, prompt, targetDur]);

  const handleAdd = () => {
    if (!resultBlob) return;
    onAdd(resultBlob, resultDur, prompt, model.name, model.task);
    onClose();
  };

  const isTTS = model.task === "tts";

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">

        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-title-icon">✦</span>
            Generate Audio
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Model picker */}
        <div className="model-picker">
          <div className="model-picker-label">Model</div>
          <div className="model-grid">
            {AUDIO_MODELS.map((m) => (
              <button
                key={m.id}
                className={`model-card ${selectedModelId === m.id ? "active" : ""}`}
                style={{ "--model-color": m.color } as React.CSSProperties}
                onClick={() => selectModel(m)}
                disabled={isGenerating}
              >
                <div className="model-card-tag" style={{ background: m.color }}>
                  {m.tag}
                </div>
                <div className="model-card-name">{m.name}</div>
                <div className="model-card-size">{m.size}</div>
                {isModelLoaded(m.id) && <div className="model-card-loaded">●</div>}
              </button>
            ))}
          </div>
          <div className="model-desc">{model.description}</div>
        </div>

        {/* Scene stats */}
        <div className="modal-scene-info">
          <div className="modal-scene-stat">
            <span className="modal-scene-stat-label">Video clips</span>
            <span className="modal-scene-stat-value">{videoClips.length}</span>
          </div>
          <div className="modal-scene-stat">
            <span className="modal-scene-stat-label">Scene</span>
            <span className="modal-scene-stat-value">{formatDuration(sceneDuration)}</span>
          </div>
          {!isTTS && (
            <div className="modal-scene-stat">
              <span className="modal-scene-stat-label">Max gen</span>
              <span className="modal-scene-stat-value">{model.maxDurationSeconds ?? 30}s</span>
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="modal-section">
          <label className="modal-label">
            {isTTS ? "Narration text" : "Scene description"}
          </label>
          <textarea
            className="modal-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={isTTS ? 3 : 2}
            placeholder={
              isTTS
                ? "Type the narration or voiceover text…"
                : "Describe the mood, style, and feel…"
            }
            disabled={isGenerating}
          />
          <div className="modal-presets">
            {model.prompts.map((p) => (
              <button
                key={p}
                className={`modal-preset-btn ${prompt === p ? "active" : ""}`}
                style={{ "--model-color": model.color } as React.CSSProperties}
                onClick={() => setPrompt(p)}
                disabled={isGenerating}
              >
                {p.length > 28 ? p.slice(0, 26) + "…" : p}
              </button>
            ))}
          </div>
        </div>

        {/* Speed (TTS only) */}
        {isTTS && (
          <div className="modal-section">
            <div className="modal-label-row">
              <label className="modal-label">Speaking speed</label>
              <span className="modal-dur-val">{speed.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1.2}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              disabled={isGenerating}
              style={{ width: "100%", accentColor: model.color }}
            />
            <div className="modal-dur-hint">
              {speed < 0.7 ? "Very slow — clear and deliberate" : speed < 0.9 ? "Slow — relaxed narration" : speed < 1.05 ? "Normal pace" : "Fast"}
            </div>
          </div>
        )}

        {/* Duration (music only) */}
        {!isTTS && (
          <div className="modal-section">
            <div className="modal-label-row">
              <label className="modal-label">Target duration</label>
              <span className="modal-dur-val">{targetDur}s</span>
            </div>
            <input
              type="range"
              min={3}
              max={model.maxDurationSeconds ?? 30}
              step={1}
              value={targetDur}
              onChange={(e) => setTargetDur(parseInt(e.target.value))}
              disabled={isGenerating}
              style={{ width: "100%", accentColor: model.color }}
            />
            <div className="modal-dur-hint">
              {sceneDuration > 0 && targetDur > sceneDuration
                ? `⚠ Longer than scene (${formatDuration(sceneDuration)})`
                : sceneDuration > 0
                ? `${Math.round((targetDur / sceneDuration) * 100)}% of scene length`
                : "No video clips on timeline yet"}
            </div>
          </div>
        )}

        {/* Progress */}
        {isGenerating && (
          <div className="modal-progress">
            <div className="modal-progress-track">
              <div
                className="modal-progress-fill"
                style={{
                  width: `${progressPct}%`,
                  background: `linear-gradient(90deg, ${model.color}, ${model.color}aa)`,
                }}
              />
            </div>
            <div className="modal-progress-label">{statusText}</div>
          </div>
        )}

        {!isGenerating && phase.state !== "idle" && (
          <div className={`modal-status ${phase.state === "error" ? "modal-status-error" : phase.state === "ready" ? "modal-status-ok" : ""}`}>
            {statusText}
          </div>
        )}

        {/* Preview */}
        {previewUrl && (
          <div className="modal-preview">
            <div className="modal-preview-label">
              Preview — {resultDur.toFixed(1)}s · {model.sampleRate / 1000} kHz
            </div>
            <audio src={previewUrl} controls style={{ width: "100%", height: 36 }} />
          </div>
        )}

        {/* Actions */}
        <div className="modal-actions">
          <button
            className="modal-btn-generate"
            style={{ background: isGenerating ? undefined : model.color }}
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? "Generating…" : resultBlob ? "↺ Regenerate" : "✦ Generate"}
          </button>

          {resultBlob && (
            <button className="modal-btn-add" onClick={handleAdd}>
              + Add to Track
            </button>
          )}

          <button className="modal-btn-cancel" onClick={onClose} disabled={isGenerating}>
            Cancel
          </button>
        </div>

        {!isModelLoaded(model.id) && phase.state === "idle" && (
          <div className="modal-footnote">
            {model.name} ({model.size}) downloads once and is cached in your browser.
          </div>
        )}
      </div>
    </div>
  );
}
