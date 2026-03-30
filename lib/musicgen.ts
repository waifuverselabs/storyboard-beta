"use client";

/**
 * Audio generation pipeline.
 * Supports any model defined in lib/audioModels.ts via @xenova/transformers.
 */

import type { AudioModel } from "./audioModels";

export type LoadPhase =
  | { state: "idle" }
  | { state: "downloading"; file: string; pct: number }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "generating"; tokensGenerated: number; maxTokens: number }
  | { state: "error"; message: string };

// One pipeline instance per model ID
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelines = new Map<string, any>();
const loadPromises = new Map<string, Promise<void>>();

export async function loadModel(
  model: AudioModel,
  onPhase: (p: LoadPhase) => void
): Promise<void> {
  if (pipelines.has(model.id)) {
    onPhase({ state: "ready" });
    return;
  }
  if (loadPromises.has(model.id)) return loadPromises.get(model.id)!;

  const p = (async () => {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;

    onPhase({ state: "downloading", file: "model config", pct: 0 });

    const instance = await pipeline(model.pipeline, model.hfModelId, {
      quantized: model.quantized !== false, // default: quantized = true
      progress_callback: (info: {
        status: string;
        file?: string;
        progress?: number;
      }) => {
        if (info.status === "progress" || info.status === "downloading") {
          onPhase({
            state: "downloading",
            file: info.file ?? "weights",
            pct: Math.round(info.progress ?? 0),
          });
        } else if (info.status === "initiate") {
          onPhase({ state: "downloading", file: info.file ?? "model", pct: 0 });
        } else if (info.status === "done") {
          onPhase({ state: "loading" });
        }
      },
    });

    pipelines.set(model.id, instance);
    onPhase({ state: "ready" });
  })();

  loadPromises.set(model.id, p);
  try {
    await p;
  } catch (e) {
    loadPromises.delete(model.id);
    throw e;
  }
}

export interface GenerateOptions {
  model: AudioModel;
  prompt: string;
  /** Target duration in seconds (music only — ignored for TTS) */
  durationSeconds?: number;
  onPhase: (p: LoadPhase) => void;
}

export async function generateAudio({
  model,
  prompt,
  durationSeconds = 10,
  onPhase,
}: GenerateOptions): Promise<{ blob: Blob; durationSeconds: number; sampleRate: number }> {
  await loadModel(model, onPhase);

  const pipe = pipelines.get(model.id)!;

  // ── Music generation (MusicGen) ──────────────────────────────────────────
  if (model.task === "music") {
    const targetDur = Math.min(durationSeconds, model.maxDurationSeconds ?? 30);
    const tps = model.tokensPerSecond ?? 50;
    const maxTokens = Math.max(50, Math.round(targetDur * tps));

    onPhase({ state: "generating", tokensGenerated: 0, maxTokens });

    let lastToken = 0;
    const result = await pipe(prompt, {
      max_new_tokens: maxTokens,
      callback_function: (beams: Array<{ output_token_ids: number[] }>) => {
        const current = beams[0]?.output_token_ids?.length ?? 0;
        if (current !== lastToken) {
          lastToken = current;
          onPhase({ state: "generating", tokensGenerated: current, maxTokens });
        }
      },
    });

    const raw = Array.isArray(result) ? result[0] : result;
    return finalize(raw, model.sampleRate);
  }

  // ── Text-to-speech (SpeechT5 / MMS TTS) ──────────────────────────────────
  if (model.task === "tts") {
    onPhase({ state: "generating", tokensGenerated: 0, maxTokens: 100 });

    const opts: Record<string, unknown> = {};

    // SpeechT5 needs speaker embeddings
    if (model.speakerEmbeddingUrl) {
      const { RawImage } = await import("@xenova/transformers");
      // RawImage isn't what we need — use fetch to grab the .bin file
      const resp = await fetch(model.speakerEmbeddingUrl);
      const buf = await resp.arrayBuffer();
      const { Tensor } = await import("@xenova/transformers");
      // Speaker embedding is a 512-dim float32 vector
      const data = new Float32Array(buf);
      opts.speaker_embeddings = new Tensor("float32", data, [1, data.length]);
    }

    const result = await pipe(prompt, opts);
    const raw = Array.isArray(result) ? result[0] : result;
    onPhase({ state: "generating", tokensGenerated: 100, maxTokens: 100 });
    return finalize(raw, model.sampleRate);
  }

  throw new Error(`Unsupported model task: ${model.task}`);
}

function finalize(
  raw: { audio: Float32Array; sampling_rate: number; toBlob?: () => Blob; data?: Float32Array },
  fallbackSampleRate: number
): { blob: Blob; durationSeconds: number; sampleRate: number } {
  const blob: Blob = typeof raw.toBlob === "function"
    ? raw.toBlob()
    : encodeWAV(raw.audio ?? raw.data ?? new Float32Array(0), raw.sampling_rate ?? fallbackSampleRate);

  const sampleRate = raw.sampling_rate ?? fallbackSampleRate;
  const audioData: Float32Array = raw.data instanceof Float32Array
    ? raw.data
    : raw.audio instanceof Float32Array
    ? raw.audio
    : new Float32Array(0);

  const dur = audioData.length > 0 ? audioData.length / sampleRate : 0;
  return { blob, durationSeconds: dur, sampleRate };
}

/** WAV encoder fallback for models that don't expose .toBlob() */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const numCh = 1, bps = 16;
  const byteRate = (sampleRate * numCh * bps) / 8;
  const blockAlign = (numCh * bps) / 8;
  const dataSize = samples.length * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, bps, true);
  ws(36, "data"); v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function isModelLoaded(modelId: string): boolean {
  return pipelines.has(modelId);
}
