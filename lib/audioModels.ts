/**
 * Registry of browser-runnable audio generation models.
 * Add any new model here — the generation pipeline reads config from this file.
 */

export type AudioTask = "music" | "tts" | "sfx";
export type AudioEngine = "transformers" | "kokoro";

export interface AudioModel {
  id: string;
  name: string;
  tag: string;              // short badge label
  description: string;
  size: string;             // human-readable download size
  task: AudioTask;
  engine?: AudioEngine;
  hfModelId: string;        // Hugging Face model ID
  pipeline?: "text-to-audio" | "text-to-speech";
  sampleRate: number;
  /** ~tokens per second of audio (MusicGen only — undefined for TTS) */
  tokensPerSecond?: number;
  maxDurationSeconds?: number;
  /** URL to speaker embeddings .bin (SpeechT5 only) */
  speakerEmbeddingUrl?: string;
  /** Some models want quantized: false for better quality */
  quantized?: boolean;
  /** Kokoro voice identifier */
  voice?: string;
  /** Kokoro speaking speed */
  speed?: number;
  /** Prefer this model when opening the modal */
  defaultSelected?: boolean;
  prompts: string[];        // suggested prompts shown in the modal
  color: string;            // accent color for the card
}

export const AUDIO_MODELS: AudioModel[] = [
  // ── Music generation ────────────────────────────────────────────────────
  {
    id: "musicgen-small",
    name: "MusicGen Small",
    tag: "MUSIC",
    description: "Fast text-to-music. Great for background tracks, ~5–30s clips.",
    size: "~183 MB",
    task: "music",
    engine: "transformers",
    hfModelId: "Xenova/musicgen-small",
    pipeline: "text-to-audio",
    sampleRate: 32000,
    tokensPerSecond: 50,
    maxDurationSeconds: 30,
    color: "#8b5cf6",
    prompts: [
      "Cinematic orchestral score, dramatic strings and brass",
      "Lo-fi hip hop, chill beats, warm vinyl crackle",
      "Ambient electronic, atmospheric pads, calm and ethereal",
      "Upbeat pop music, energetic rhythm, bright and positive",
      "Dark dramatic underscore, tense and suspenseful",
      "Acoustic guitar fingerpicking, warm and nostalgic",
    ],
  },
  // ── Text-to-speech ───────────────────────────────────────────────────────
  {
    id: "kokoro-soft",
    name: "Kokoro Soft",
    tag: "TTS",
    description:
      "Kokoro 82M runs fully in-browser and defaults to a softer, slower delivery for gentle narration.",
    size: "~330 MB",
    task: "tts",
    engine: "kokoro",
    hfModelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sampleRate: 24000,
    voice: "af_nicole",
    speed: 0.8,
    defaultSelected: true,
    color: "#ec4899",
    prompts: [
      "Let the room settle for a second, and just listen to the quiet around you.",
      "Stay close. I'll keep my voice soft and slow while the rest of the world fades back.",
      "Take a slow breath in, hold it, and let it go without rushing.",
    ],
  },
  {
    id: "kokoro-heart",
    name: "Kokoro Heart",
    tag: "TTS",
    description:
      "af_heart — warm, expressive American female voice. Highly rated for emotional narration.",
    size: "~330 MB",
    task: "tts",
    engine: "kokoro",
    hfModelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sampleRate: 24000,
    voice: "af_heart",
    speed: 0.85,
    color: "#e879a0",
    prompts: [
      "There's something about this moment that feels worth holding onto.",
      "She looked back once, just to make sure she hadn't imagined it.",
      "The kind of quiet that follows isn't emptiness — it's presence.",
    ],
  },
  {
    id: "kokoro-bella",
    name: "Kokoro Bella",
    tag: "TTS",
    description:
      "af_bella — clear, confident American female voice with a natural, grounded tone.",
    size: "~330 MB",
    task: "tts",
    engine: "kokoro",
    hfModelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sampleRate: 24000,
    voice: "af_bella",
    speed: 0.85,
    color: "#d946a8",
    prompts: [
      "Every decision you've made has led to exactly this point.",
      "The data tells a clear story — and it's one worth paying attention to.",
      "This is where we begin. Everything else follows from here.",
    ],
  },
];

export function getModel(id: string): AudioModel {
  const m = AUDIO_MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown audio model: ${id}`);
  return m;
}
