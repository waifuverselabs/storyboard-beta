"use client";

/**
 * Main-thread interface to the audio generation Web Worker.
 * All heavy work (ONNX model loading + inference) runs in audioWorker.ts,
 * keeping the UI fully responsive.
 */

import type { AudioModel } from "./audioModels";

export type LoadPhase =
  | { state: "idle" }
  | { state: "downloading"; file: string; pct: number }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "generating"; tokensGenerated: number; maxTokens: number }
  | { state: "error"; message: string };

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./audioWorker.ts", import.meta.url));
  }
  return worker;
}

// Track which model IDs have been fully loaded (ready) in the worker
const loadedModels = new Set<string>();

export interface GenerateOptions {
  model: AudioModel;
  prompt: string;
  durationSeconds?: number;
  speed?: number;
  onPhase: (p: LoadPhase) => void;
}

export function generateAudio({
  model,
  prompt,
  durationSeconds = 10,
  speed,
  onPhase,
}: GenerateOptions): Promise<{ blob: Blob; durationSeconds: number; sampleRate: number }> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = Math.random().toString(36).slice(2, 10);

    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;

      if (e.data.type === "phase") {
        const phase: LoadPhase = e.data.phase;
        onPhase(phase);
        if (phase.state === "ready") loadedModels.add(model.id);
        return;
      }

      // Done or error — remove listener
      w.removeEventListener("message", handler);

      if (e.data.type === "done") {
        const blob = new Blob([e.data.buffer as ArrayBuffer], { type: "audio/wav" });
        resolve({ blob, durationSeconds: e.data.durationSeconds, sampleRate: e.data.sampleRate });
        return;
      }

      if (e.data.type === "error") {
        reject(new Error(e.data.message));
      }
    };

    w.addEventListener("message", handler);
    w.postMessage({ type: "generate", id, modelId: model.id, prompt, durationSeconds, speed });
  });
}

export function isModelLoaded(modelId: string): boolean {
  return loadedModels.has(modelId);
}
