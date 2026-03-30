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
    speed: 0.92,
    defaultSelected: true,
    color: "#ec4899",
    prompts: [
      "Let the room settle for a second, and just listen to the quiet around you.",
      "Stay close. I'll keep my voice soft and slow while the rest of the world fades back.",
      "Take a slow breath in, hold it, and let it go without rushing.",
    ],
  },
  {
    id: "kokoro-airy",
    name: "Kokoro Airy",
    tag: "TTS",
    description:
      "An airier Kokoro preset using af_sky for lighter, breathier narration while staying fully in-browser.",
    size: "~330 MB",
    task: "tts",
    engine: "kokoro",
    hfModelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sampleRate: 24000,
    voice: "af_sky",
    speed: 0.9,
    color: "#f472b6",
    prompts: [
      "Keep it light and close, like the room is already quiet before I start speaking.",
      "The air feels still tonight, and every word lands a little softer than before.",
      "Nothing has to move quickly right now. Let the pace stay easy.",
    ],
  },
];

export function getModel(id: string): AudioModel {
  const m = AUDIO_MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown audio model: ${id}`);
  return m;
}
