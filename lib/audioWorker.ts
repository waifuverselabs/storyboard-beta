/**
 * Web Worker — runs all model loading and audio generation off the main thread.
 * Spawned once, reused for the lifetime of the page.
 *
 * Message protocol
 * ─────────────────
 * IN  → { type: 'generate', id, modelId, prompt, durationSeconds }
 * OUT ← { type: 'phase',    id, phase }       — progress updates
 * OUT ← { type: 'done',     id, buffer, durationSeconds, sampleRate }
 * OUT ← { type: 'error',    id, message }
 */

// We're in a DedicatedWorkerGlobalScope — cast self explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

import { AUDIO_MODELS } from "./audioModels";
import type { LoadPhase } from "./musicgen";

// One pipeline instance per model ID
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelines = new Map<string, any>();

async function getOrLoadPipeline(
  modelId: string,
  postPhase: (p: LoadPhase) => void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (pipelines.has(modelId)) return pipelines.get(modelId);

  const model = AUDIO_MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  // Dynamic import inside the worker — webpack bundles this correctly
  const { pipeline, env } = await import("@huggingface/transformers");

  env.allowLocalModels = false;
  // Run ONNX directly on this worker thread — no sub-worker needed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env as any).backends.onnx.wasm.proxy = false;

  postPhase({ state: "downloading", file: "model config", pct: 0 });

  const instance = await pipeline(model.pipeline, model.hfModelId, {
    dtype: model.quantized === false ? "fp32" : "q8",
    progress_callback: (info: { status: string; file?: string; progress?: number }) => {
      if (info.status === "progress" || info.status === "downloading") {
        postPhase({
          state: "downloading",
          file: info.file ?? "weights",
          pct: Math.round(info.progress ?? 0),
        });
      } else if (info.status === "initiate") {
        postPhase({ state: "downloading", file: info.file ?? "model", pct: 0 });
      } else if (info.status === "done") {
        postPhase({ state: "loading" });
      }
    },
  });

  pipelines.set(modelId, instance);
  postPhase({ state: "ready" });
  return instance;
}

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numCh = 1, bps = 16;
  const byteRate = (sampleRate * numCh * bps) / 8;
  const dataSize = samples.length * (bps / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true);
  v.setUint16(32, numCh * bps / 8, true); v.setUint16(34, bps, true);
  ws(36, "data"); v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buf;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, modelId, prompt, durationSeconds } = e.data as {
    type: string;
    id: string;
    modelId: string;
    prompt: string;
    durationSeconds: number;
  };

  if (type !== "generate") return;

  const postPhase = (phase: LoadPhase) =>
    self.postMessage({ type: "phase", id, phase });

  try {
    const model = AUDIO_MODELS.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);

    const pipe = await getOrLoadPipeline(modelId, postPhase);

    // ── Music generation ─────────────────────────────────────────────────
    if (model.task === "music") {
      const tps = model.tokensPerSecond ?? 50;
      const maxTokens = Math.max(50, Math.round(Math.min(durationSeconds, 30) * tps));

      postPhase({ state: "generating", tokensGenerated: 0, maxTokens });

      let lastToken = 0;
      const result = await pipe(prompt, {
        max_new_tokens: maxTokens,
        callback_function: (beams: Array<{ output_token_ids: number[] }>) => {
          const current = beams[0]?.output_token_ids?.length ?? 0;
          if (current !== lastToken) {
            lastToken = current;
            postPhase({ state: "generating", tokensGenerated: current, maxTokens });
          }
        },
      });

      const raw = Array.isArray(result) ? result[0] : result;
      const sampleRate: number = raw.sampling_rate ?? model.sampleRate;
      const audioData: Float32Array =
        raw.data instanceof Float32Array ? raw.data :
        raw.audio instanceof Float32Array ? raw.audio :
        new Float32Array(0);

      const dur = audioData.length / sampleRate;
      // Use built-in toBlob if available, otherwise encode manually
      let buffer: ArrayBuffer;
      if (typeof raw.toBlob === "function") {
        const blob: Blob = raw.toBlob();
        buffer = await blob.arrayBuffer();
      } else {
        buffer = encodeWAV(audioData, sampleRate);
      }

      // Transfer the buffer to the main thread (zero-copy)
      self.postMessage({ type: "done", id, buffer, durationSeconds: dur, sampleRate }, [buffer]);
      return;
    }

    // ── Text-to-speech ───────────────────────────────────────────────────
    if (model.task === "tts") {
      postPhase({ state: "generating", tokensGenerated: 0, maxTokens: 100 });

      const opts: Record<string, unknown> = {};

      if (model.speakerEmbeddingUrl) {
        const resp = await fetch(model.speakerEmbeddingUrl);
        const buf = await resp.arrayBuffer();
        const { Tensor } = await import("@huggingface/transformers");
        const data = new Float32Array(buf);
        opts.speaker_embeddings = new Tensor("float32", data, [1, data.length]);
      }

      const result = await pipe(prompt, opts);
      const raw = Array.isArray(result) ? result[0] : result;

      postPhase({ state: "generating", tokensGenerated: 100, maxTokens: 100 });

      const sampleRate: number = raw.sampling_rate ?? model.sampleRate;
      const audioData: Float32Array =
        raw.data instanceof Float32Array ? raw.data :
        raw.audio instanceof Float32Array ? raw.audio :
        new Float32Array(0);

      const dur = audioData.length / sampleRate;
      let buffer: ArrayBuffer;
      if (typeof raw.toBlob === "function") {
        const blob: Blob = raw.toBlob();
        buffer = await blob.arrayBuffer();
      } else {
        buffer = encodeWAV(audioData, sampleRate);
      }

      self.postMessage({ type: "done", id, buffer, durationSeconds: dur, sampleRate }, [buffer]);
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
