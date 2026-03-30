"use client";

// MusicGen Small via @xenova/transformers — fully client-side, no server
// @xenova/transformers v2 is webpack-compatible (no import.meta / native binaries)

export type LoadPhase =
  | { state: "idle" }
  | { state: "downloading"; file: string; pct: number }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "generating"; tokensGenerated: number; maxTokens: number }
  | { state: "error"; message: string };

// Singleton pipeline — loaded once, reused
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeInstance: any | null = null;
let loadPromise: Promise<void> | null = null;

export async function loadMusicGen(
  onPhase: (p: LoadPhase) => void
): Promise<void> {
  if (pipeInstance) {
    onPhase({ state: "ready" });
    return;
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Dynamic import keeps this out of SSR — only runs in the browser
    const { pipeline, env } = await import("@xenova/transformers");

    // Always fetch from Hugging Face Hub (never look for local files)
    env.allowLocalModels = false;

    onPhase({ state: "downloading", file: "model config", pct: 0 });

    pipeInstance = await pipeline(
      "text-to-audio",
      "Xenova/musicgen-small",
      {
        progress_callback: (info: {
          status: string;
          file?: string;
          progress?: number;
        }) => {
          if (info.status === "progress" || info.status === "downloading") {
            onPhase({
              state: "downloading",
              file: info.file ?? "model weights",
              pct: Math.round(info.progress ?? 0),
            });
          } else if (info.status === "initiate") {
            onPhase({ state: "downloading", file: info.file ?? "model", pct: 0 });
          } else if (info.status === "done") {
            onPhase({ state: "loading" });
          }
        },
      }
    );

    onPhase({ state: "ready" });
  })();

  try {
    await loadPromise;
  } catch (e) {
    loadPromise = null;
    pipeInstance = null;
    throw e;
  }
}

export interface GenerateOptions {
  prompt: string;
  /** Target duration in seconds — capped at 30s (model limit) */
  durationSeconds: number;
  onPhase: (p: LoadPhase) => void;
}

/**
 * Generate music from a text prompt.
 * Returns a WAV Blob built from the RawAudio output.
 */
export async function generateMusic({
  prompt,
  durationSeconds,
  onPhase,
}: GenerateOptions): Promise<{ blob: Blob; durationSeconds: number; sampleRate: number }> {
  await loadMusicGen(onPhase);

  // ~50 tokens/second at 32 kHz. Cap at 30s (1500 tokens).
  const targetDur = Math.min(durationSeconds, 30);
  const maxTokens = Math.max(50, Math.round(targetDur * 50));

  onPhase({ state: "generating", tokensGenerated: 0, maxTokens });

  let lastToken = 0;
  const result = await pipeInstance(prompt, {
    max_new_tokens: maxTokens,
    callback_function: (beams: Array<{ output_token_ids: number[] }>) => {
      const current = beams[0]?.output_token_ids?.length ?? 0;
      if (current !== lastToken) {
        lastToken = current;
        onPhase({ state: "generating", tokensGenerated: current, maxTokens });
      }
    },
  });

  // Normalize to single result
  const rawAudio = Array.isArray(result) ? result[0] : result;

  // v2 RawAudio has .toBlob() → WAV Blob
  const blob: Blob = rawAudio.toBlob
    ? rawAudio.toBlob()
    : encodeWAV(rawAudio.audio, rawAudio.sampling_rate);

  const sampleRate: number = rawAudio.sampling_rate;
  const audioData: Float32Array =
    rawAudio.data instanceof Float32Array
      ? rawAudio.data
      : rawAudio.audio instanceof Float32Array
      ? rawAudio.audio
      : new Float32Array(0);

  const actualDuration = audioData.length > 0 ? audioData.length / sampleRate : targetDur;

  onPhase({ state: "ready" });
  return { blob, durationSeconds: actualDuration, sampleRate };
}

/** Fallback WAV encoder in case RawAudio.toBlob() isn't available */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ws(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function isModelCached(): boolean {
  return pipeInstance !== null;
}
