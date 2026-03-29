import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// CDN base — must be JSDelivr (not unpkg) for correct CORP headers
const CDN = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";

let ffmpegInstance: FFmpeg | null = null;

export async function getFFmpeg(
  onLog?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  const ffmpeg = new FFmpeg();

  if (onLog) {
    ffmpeg.on("log", ({ message }) => {
      if (
        !message.startsWith("ffmpeg version") &&
        !message.startsWith("  built") &&
        !message.startsWith("  configuration") &&
        !message.startsWith("  lib") &&
        !message.includes("Guessed Channel")
      ) {
        onLog(message);
      }
    });
  }

  await ffmpeg.load({
    coreURL: await toBlobURL(`${CDN}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CDN}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export interface VideoInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  duration: number; // seconds
}

function parseFps(str: string): number {
  const parts = str?.split("/");
  if (parts?.length === 2) {
    const n = parseInt(parts[0]);
    const d = parseInt(parts[1]);
    if (d > 0) return Math.round((n / d) * 100) / 100;
  }
  return 30;
}

export async function probeFile(
  ffmpeg: FFmpeg,
  filename: string
): Promise<VideoInfo> {
  const logs: string[] = [];
  const handler = ({ message }: { message: string }) => logs.push(message);
  ffmpeg.on("log", handler);

  try {
    await ffmpeg.exec(["-i", filename, "-f", "null", "-"]).catch(() => {});
  } finally {
    ffmpeg.off("log", handler);
  }

  const combined = logs.join("\n");

  const videoMatch = combined.match(
    /Video:\s+(\w+)[^,]*,\s*[^,]+,\s*(\d+)x(\d+)[^,]*,?\s*(?:[\d.]+ kb\/s,\s*)?([\d.]+(?:\/\d+)?) (?:fps|tbr)/
  );
  const audioMatch = combined.match(/Audio:/);
  const durMatch = combined.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);

  if (!videoMatch) {
    throw new Error("Could not read video stream info. Is this a valid video?");
  }

  const duration = durMatch
    ? parseInt(durMatch[1]) * 3600 +
      parseInt(durMatch[2]) * 60 +
      parseFloat(durMatch[3])
    : 0;

  return {
    codec: videoMatch[1],
    width: parseInt(videoMatch[2]),
    height: parseInt(videoMatch[3]),
    fps: parseFps(videoMatch[4]),
    hasAudio: !!audioMatch,
    duration,
  };
}

// Cap the long edge to keep ffmpeg.wasm within its WASM heap limit.
// 2784×4096 = ~43 MB of raw YUV per frame; with B-frame lookahead ffmpeg
// holds many at once and hits the WASM heap ceiling.
const MAX_LONG_EDGE = 1920;

function clampRes(w: number, h: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= MAX_LONG_EDGE) return { w, h };
  const ratio = MAX_LONG_EDGE / longest;
  return {
    w: Math.round((w * ratio) / 2) * 2,
    h: Math.round((h * ratio) / 2) * 2,
  };
}

export interface StitchOptions {
  files: File[];
  onLog: (msg: string) => void;
  onProgress: (pct: number) => void;
}

export async function smartStitch({
  files,
  onLog,
  onProgress,
}: StitchOptions): Promise<Blob> {
  onLog("Loading ffmpeg.wasm…");
  const ffmpeg = await getFFmpeg(onLog);
  onProgress(5);

  onLog("Writing files to memory…");
  const names: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = `input_${i}.mp4`;
    await ffmpeg.writeFile(name, await fetchFile(files[i]));
    names.push(name);
    onProgress(5 + (i + 1) * 5);
  }

  onLog("Probing video streams…");
  const infos: VideoInfo[] = [];
  for (let i = 0; i < names.length; i++) {
    const info = await probeFile(ffmpeg, names[i]);
    infos.push(info);
    onLog(
      `Video ${i + 1}: ${info.codec} ${info.width}×${info.height} @ ${info.fps}fps` +
        (info.hasAudio ? "" : " [no audio]")
    );
  }
  onProgress(25);

  const ref = infos[0];
  const anyAudio = infos.some((v) => v.hasAudio);
  const { w: outW, h: outH } = clampRes(ref.width, ref.height);

  if (outW !== ref.width || outH !== ref.height) {
    onLog(
      `Clamping to ${outW}×${outH} (${ref.width}×${ref.height} exceeds WASM safe limit)`
    );
  }

  // --- Phase 1: normalize each video independently ---
  // One ffmpeg call per video keeps peak memory bounded to a single clip.
  // Videos that only need an audio track added use -c:v copy (no re-encode).
  // Videos that need re-encode use ultrafast preset for speed.
  const readyNames: string[] = [];

  for (let i = 0; i < names.length; i++) {
    const info = infos[i];
    const needsVideoRecode =
      info.width !== outW ||
      info.height !== outH ||
      info.fps !== ref.fps;
    const needsAudio = anyAudio && !info.hasAudio;
    const needsAudioRecode = anyAudio && info.hasAudio;

    if (!needsVideoRecode && !needsAudio && !needsAudioRecode) {
      onLog(`Video ${i + 1}: OK ✓`);
      readyNames.push(names[i]);
      onProgress(25 + ((i + 1) / names.length) * 55);
      continue;
    }

    const outName = `norm_${i}.mp4`;

    if (!needsVideoRecode && needsAudio) {
      // Only add silent audio — copy video stream untouched (fast)
      onLog(`Video ${i + 1}: Adding audio track…`);
      const exit = await ffmpeg.exec([
        "-i", names[i],
        "-f", "lavfi",
        "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        outName,
      ]);
      if (exit !== 0) throw new Error(`Audio add failed for video ${i + 1}`);
    } else {
      // Re-encode video (and audio if needed). ultrafast preset for speed.
      onLog(`Video ${i + 1}: Re-encoding…`);
      const vf = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,` +
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,fps=${ref.fps}`;

      const audioArgs = anyAudio
        ? info.hasAudio
          ? ["-c:a", "aac", "-ar", "44100", "-ac", "2"]
          : ["-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
             "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest"]
        : ["-an"];

      // For lavfi input we need to insert it before output args
      const hasLavfi = anyAudio && !info.hasAudio;
      const args = hasLavfi
        ? [
            "-i", names[i],
            "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-shortest",
            outName,
          ]
        : [
            "-i", names[i],
            "-vf", vf,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            ...audioArgs,
            outName,
          ];

      const exit = await ffmpeg.exec(args);
      if (exit !== 0) throw new Error(`Re-encode failed for video ${i + 1}`);
    }

    onLog(`Video ${i + 1}: Done ✓`);
    readyNames.push(outName);
    onProgress(25 + ((i + 1) / names.length) * 55);
  }

  // --- Phase 2: concat copy — zero re-encoding, instant ---
  onLog("Stitching…");
  const listContent = readyNames.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("list.txt", listContent);

  const concatExit = await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-c", "copy",
    "-reset_timestamps", "1",
    "-movflags", "+faststart",
    "output.mp4",
  ]);
  if (concatExit !== 0) throw new Error("Concat failed");
  onProgress(95);

  const data = await ffmpeg.readFile("output.mp4");
  onProgress(100);
  onLog("Done ✓");

  for (const n of [...names, ...readyNames, "list.txt", "output.mp4"]) {
    try { await ffmpeg.deleteFile(n); } catch {}
  }

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
}
