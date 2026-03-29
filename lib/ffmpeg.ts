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
      // Filter noisy ffmpeg startup lines
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

/**
 * Probe a file using ffmpeg -i and parse stderr output.
 * ffmpeg.wasm doesn't include ffprobe, so we use the -i trick.
 */
export async function probeFile(
  ffmpeg: FFmpeg,
  filename: string
): Promise<VideoInfo> {
  const logs: string[] = [];
  const handler = ({ message }: { message: string }) => logs.push(message);
  ffmpeg.on("log", handler);

  try {
    // This intentionally "fails" — we just want the stream info printed to log
    await ffmpeg.exec(["-i", filename, "-f", "null", "-"]).catch(() => {});
  } finally {
    ffmpeg.off("log", handler);
  }

  const combined = logs.join("\n");

  // Parse: Video: h264 (High), yuv420p, 1920x1080 [SAR ...], 30 fps
  const videoMatch = combined.match(
    /Video:\s+(\w+)[^,]*,\s*[^,]+,\s*(\d+)x(\d+)[^,]*,?\s*(?:[\d.]+ kb\/s,\s*)?([\d.]+(?:\/\d+)?) (?:fps|tbr)/
  );
  const audioMatch = combined.match(/Audio:/);

  if (!videoMatch) {
    throw new Error("Could not read video stream info. Is this a valid video?");
  }

  return {
    codec: videoMatch[1],
    width: parseInt(videoMatch[2]),
    height: parseInt(videoMatch[3]),
    fps: parseFps(videoMatch[4]),
    hasAudio: !!audioMatch,
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
      `Video ${i + 1}: ${info.codec} ${info.width}×${info.height} @ ${info.fps}fps${info.hasAudio ? "" : " [no audio]"}`
    );
  }
  onProgress(30);

  const ref = infos[0];
  const anyAudio = infos.some((v) => v.hasAudio);

  // Single-pass filter_complex: normalize all inputs then concat.
  // Avoids intermediate files and the corrupt-NAL issues that come from
  // encoding a file twice (normalize pass → concat pass).
  onLog(`Concatenating ${names.length} videos…`);

  const inputArgs = names.flatMap((n) => ["-i", n]);
  const filters: string[] = [];

  for (let i = 0; i < names.length; i++) {
    // Scale to ref dims (letterbox if needed), normalize fps, reset PTS
    filters.push(
      `[${i}:v]` +
        `scale=${ref.width}:${ref.height}:force_original_aspect_ratio=decrease,` +
        `pad=${ref.width}:${ref.height}:(ow-iw)/2:(oh-ih)/2,` +
        `fps=${ref.fps},setpts=PTS-STARTPTS[nv${i}]`
    );
    if (anyAudio) {
      if (infos[i].hasAudio) {
        // Normalize to stereo 44100 and reset PTS
        filters.push(
          `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[na${i}]`
        );
      } else {
        // Generate silence for video-only clips
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100[na${i}]`);
      }
    }
  }

  const vIn = names.map((_, i) => `[nv${i}]`).join("");
  const aIn = anyAudio ? names.map((_, i) => `[na${i}]`).join("") : "";
  filters.push(
    anyAudio
      ? `${vIn}${aIn}concat=n=${names.length}:v=1:a=1[outv][outa]`
      : `${vIn}concat=n=${names.length}:v=1:a=0[outv]`
  );

  const mapArgs = anyAudio
    ? ["-map", "[outv]", "-map", "[outa]"]
    : ["-map", "[outv]"];
  const encodeArgs = anyAudio
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
       "-c:a", "aac", "-ar", "44100", "-ac", "2"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an"];

  const exitCode = await ffmpeg.exec([
    ...inputArgs,
    "-filter_complex", filters.join(";"),
    ...mapArgs,
    ...encodeArgs,
    "output.mp4",
  ]);

  if (exitCode !== 0) {
    throw new Error(`Encoding failed (exit ${exitCode})`);
  }

  onProgress(95);

  const data = await ffmpeg.readFile("output.mp4");
  onProgress(100);
  onLog("Done ✓");

  for (const n of [...names, "output.mp4"]) {
    try { await ffmpeg.deleteFile(n); } catch {}
  }

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
}
