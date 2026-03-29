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

function infosMatch(infos: VideoInfo[]): boolean {
  const ref = infos[0];
  return infos.every(
    (i) =>
      i.codec === ref.codec &&
      i.width === ref.width &&
      i.height === ref.height &&
      i.fps === ref.fps &&
      i.hasAudio === ref.hasAudio
  );
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

  // Write all input files to the virtual FS
  onLog("Writing files to memory…");
  const names: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = `input_${i}.mp4`;
    await ffmpeg.writeFile(name, await fetchFile(files[i]));
    names.push(name);
    onProgress(5 + (i + 1) * 5);
  }

  // Probe each file
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
  const match = infosMatch(infos);

  let readyNames: string[] = [...names];

  if (!match) {
    onLog(
      `Format mismatch — normalizing to ${ref.width}×${ref.height} @ ${ref.fps}fps…`
    );

    readyNames = [];
    for (let i = 0; i < names.length; i++) {
      const info = infos[i];
      const needsRecode =
        info.width !== ref.width ||
        info.height !== ref.height ||
        info.fps !== ref.fps ||
        (!info.hasAudio && ref.hasAudio);

      if (!needsRecode) {
        onLog(`Video ${i + 1}: OK, no re-encode needed`);
        readyNames.push(names[i]);
      } else {
        const outName = `norm_${i}.mp4`;
        onLog(`Video ${i + 1}: Re-encoding…`);

        const filterArgs = ref.hasAudio
          ? [
              "-i", names[i],
              "-vf", `scale=${ref.width}:${ref.height},fps=${ref.fps}`,
              "-c:v", "libx264",
              "-preset", "veryfast",
              "-crf", "23",
              "-c:a", "aac",
              "-ar", "44100",
              "-ac", "2",
              outName,
            ]
          : [
              "-i", names[i],
              "-vf", `scale=${ref.width}:${ref.height},fps=${ref.fps}`,
              "-c:v", "libx264",
              "-preset", "veryfast",
              "-crf", "23",
              "-an",
              outName,
            ];

        await ffmpeg.exec(filterArgs);
        onLog(`Video ${i + 1}: Done ✓`);
        readyNames.push(outName);
      }
      onProgress(30 + ((i + 1) / names.length) * 35);
    }
  } else {
    onLog("All formats match ✓");
  }

  // Write concat list
  onLog("Concatenating…");
  const listContent = readyNames.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("list.txt", listContent);

  const concatArgs = [
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-c", "copy",
    "output.mp4",
  ];

  await ffmpeg.exec(concatArgs);
  onProgress(95);

  // Read result
  const data = await ffmpeg.readFile("output.mp4");
  onProgress(100);
  onLog("Done ✓");

  // Cleanup virtual FS
  for (const n of [...names, ...readyNames, "list.txt", "output.mp4"]) {
    try {
      await ffmpeg.deleteFile(n);
    } catch {}
  }

  return new Blob([data], { type: "video/mp4" });
}
