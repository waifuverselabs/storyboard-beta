/**
 * Registry of browser-runnable audio generation models.
 * Add any new model here — the generation pipeline reads config from this file.
 */

export type AudioTask = "music" | "tts" | "sfx";

export interface AudioModel {
  id: string;
  name: string;
  tag: string;              // short badge label
  description: string;
  size: string;             // human-readable download size
  task: AudioTask;
  hfModelId: string;        // Hugging Face model ID for @xenova/transformers
  pipeline: "text-to-audio" | "text-to-speech";
  sampleRate: number;
  /** ~tokens per second of audio (MusicGen only — undefined for TTS) */
  tokensPerSecond?: number;
  maxDurationSeconds?: number;
  /** URL to speaker embeddings .bin (SpeechT5 only) */
  speakerEmbeddingUrl?: string;
  /** Some models want quantized: false for better quality */
  quantized?: boolean;
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
    id: "speecht5-tts",
    name: "SpeechT5",
    tag: "TTS",
    description:
      "Microsoft SpeechT5 — high quality, natural-sounding English voice. Good for narration.",
    size: "~75 MB",
    task: "tts",
    hfModelId: "Xenova/speecht5_tts",
    pipeline: "text-to-audio",
    sampleRate: 16000,
    quantized: false,
    speakerEmbeddingUrl:
      "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin",
    color: "#0ea5e9",
    prompts: [
      "Welcome to the scene.",
      "Type any narration or voiceover text here.",
      "The quick brown fox jumps over the lazy dog.",
    ],
  },
  {
    id: "mms-tts-eng",
    name: "MMS TTS",
    tag: "TTS",
    description:
      "Meta MMS — tiny English TTS, instant generation, no speaker embeddings needed.",
    size: "~40 MB",
    task: "tts",
    hfModelId: "Xenova/mms-tts-eng",
    pipeline: "text-to-speech",
    sampleRate: 16000,
    color: "#06b6d4",
    prompts: [
      "Type any narration or voiceover text here.",
      "Welcome to the scene.",
      "And that's a wrap.",
    ],
  },
];

export function getModel(id: string): AudioModel {
  const m = AUDIO_MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown audio model: ${id}`);
  return m;
}
