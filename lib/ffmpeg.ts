import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { TimelineClip, MediaItem, Track } from "./types";
import { clampResolution } from "./mediaUtils";

const CDN = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";

let ffmpegInstance: FFmpeg | null = null;

export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
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

// ─── Probe ────────────────────────────────────────────────────────────────────

export interface VideoInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  duration: number;
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

export async function probeFile(ffmpeg: FFmpeg, filename: string): Promise<VideoInfo> {
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

  if (!videoMatch) throw new Error("Could not read video stream. Is this a valid video?");

  const duration = durMatch
    ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3])
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

// ─── atempo chain (must stay 0.5–2.0 per filter) ─────────────────────────────

function atempoChain(speed: number): string {
  if (Math.abs(speed - 1.0) < 0.001) return "";
  const filters: string[] = [];
  let s = speed;
  while (s > 2.0 + 0.001) {
    filters.push("atempo=2.0");
    s /= 2.0;
  }
  while (s < 0.5 - 0.001) {
    filters.push("atempo=0.5");
    s /= 0.5;
  }
  filters.push(`atempo=${s.toFixed(6)}`);
  return filters.join(",");
}

// ─── Timeline Export ──────────────────────────────────────────────────────────

export interface ExportOptions {
  clips: TimelineClip[];
  tracks: Track[];
  mediaItems: MediaItem[];
  onLog: (msg: string) => void;
  onProgress: (pct: number) => void;
}

export async function exportTimeline({
  clips,
  tracks,
  mediaItems,
  onLog,
  onProgress,
}: ExportOptions): Promise<Blob> {
  onLog("Loading ffmpeg.wasm…");
  const ffmpeg = await getFFmpeg(onLog);
  onProgress(5);

  // Collect unique media files needed
  const neededIds = [...new Set(clips.map((c) => c.mediaId))];
  const mediaMap = new Map<string, MediaItem>();
  neededIds.forEach((id) => {
    const m = mediaItems.find((mi) => mi.id === id);
    if (m) mediaMap.set(id, m);
  });

  if (mediaMap.size === 0) throw new Error("No media files referenced by clips.");

  // Write files to virtual FS
  onLog("Writing files to memory…");
  const fileNames = new Map<string, string>(); // mediaId → vfs filename
  let fileIdx = 0;
  for (const [id, item] of mediaMap) {
    const ext = item.name.split(".").pop()?.toLowerCase() || "mp4";
    const fname = `src_${fileIdx}.${ext}`;
    await ffmpeg.writeFile(fname, await fetchFile(item.file));
    fileNames.set(id, fname);
    fileIdx++;
    onProgress(5 + fileIdx * 3);
  }

  // Separate clips by track kind
  const videoTracks = tracks.filter((t) => t.kind === "video");
  const audioTracks = tracks.filter((t) => t.kind === "audio");

  // Gather video clips sorted by start time
  const videoClips = clips
    .filter((c) => {
      const track = tracks.find((t) => t.id === c.trackId);
      return track?.kind === "video";
    })
    .sort((a, b) => a.startTime - b.startTime);

  // Gather audio clips (both from audio tracks AND from video clips that have audio)
  const audioOnlyClips = clips.filter((c) => {
    const track = tracks.find((t) => t.id === c.trackId);
    return track?.kind === "audio";
  });

  if (videoClips.length === 0 && audioOnlyClips.length === 0) {
    throw new Error("No clips on timeline. Add some clips first.");
  }

  onLog("Probing video streams…");

  // Probe all video files to get dimensions / fps
  const probeCache = new Map<string, VideoInfo>();
  for (const [id, fname] of fileNames) {
    const item = mediaMap.get(id)!;
    if (item.kind === "video") {
      try {
        const info = await probeFile(ffmpeg, fname);
        probeCache.set(id, info);
        onLog(`  ${item.name}: ${info.width}×${info.height} @ ${info.fps}fps`);
      } catch (e) {
        onLog(`  WARN: Could not probe ${item.name}: ${e}`);
      }
    }
  }
  onProgress(25);

  // Determine output resolution
  let outW = 1920;
  let outH = 1080;
  let outFps = 30;
  if (videoClips.length > 0) {
    const firstVideoInfo = probeCache.get(videoClips[0].mediaId);
    if (firstVideoInfo) {
      const clamped = clampResolution(firstVideoInfo.width, firstVideoInfo.height);
      outW = clamped.w;
      outH = clamped.h;
      outFps = firstVideoInfo.fps || 30;
    }
  }
  onLog(`Output: ${outW}×${outH} @ ${outFps}fps`);

  // ── Build filter_complex ──────────────────────────────────────────────────

  // Build input list (for -i args)
  const inputArgs: string[] = [];
  const inputIndex = new Map<string, number>(); // mediaId → ffmpeg input index
  let inputCount = 0; // tracks the running count of -i flags added

  // First, add all media file sources
  const addedFiles = new Set<string>();
  for (const clip of [...videoClips, ...audioOnlyClips]) {
    if (!addedFiles.has(clip.mediaId)) {
      const fname = fileNames.get(clip.mediaId)!;
      if (fname) {
        inputIndex.set(clip.mediaId, inputCount);
        inputArgs.push("-i", fname);
        inputCount++;
        addedFiles.add(clip.mediaId);
      }
    }
  }

  const filters: string[] = [];
  const videoSegLabels: string[] = [];
  const audioMixLabels: string[] = [];

  // ── Video clips ────────────────────────────────────────────────────────────
  // For each video clip: trim → scale → speed → label
  // Gaps between clips are filled with black frames using color source

  let prevEnd = 0;
  let blackIdx = 0;

  for (let ci = 0; ci < videoClips.length; ci++) {
    const clip = videoClips[ci];
    const iIdx = inputIndex.get(clip.mediaId);
    if (iIdx === undefined) continue;

    const info = probeCache.get(clip.mediaId);
    const speed = Math.max(0.25, Math.min(4, clip.speed));
    const sourceDuration = clip.trimEnd - clip.trimStart;
    const label = `vclip${ci}`;

    // Insert black gap if there's a gap before this clip
    const gap = clip.startTime - prevEnd;
    if (gap > 0.05) {
      const gapLabel = `vgap${blackIdx++}`;
      const gapInputIdx = inputCount; // index of this new input
      inputArgs.push(
        "-f", "lavfi",
        "-i", `color=c=black:s=${outW}x${outH}:r=${outFps}:duration=${gap.toFixed(6)}`
      );
      inputCount++;
      filters.push(`[${gapInputIdx}:v]null[${gapLabel}]`);
      videoSegLabels.push(`[${gapLabel}]`);
    }

    // Build vf chain: trim, setpts, scale/pad, fps, optional speed, fade in/out
    const fadeIn = clip.fadeIn ?? 0;
    const fadeOut = clip.fadeOut ?? 0;
    const clipDur = clip.duration;
    let vfParts = [
      `trim=start=${clip.trimStart.toFixed(6)}:duration=${sourceDuration.toFixed(6)}`,
      `setpts=${speed !== 1 ? `(1/${speed.toFixed(6)})*` : ""}(PTS-STARTPTS)`,
      `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
      `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`,
      `fps=${outFps}`,
    ];
    if (fadeIn > 0) vfParts.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    if (fadeOut > 0) vfParts.push(`fade=t=out:st=${Math.max(0, clipDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);

    filters.push(`[${iIdx}:v]${vfParts.join(",")}[${label}]`);
    videoSegLabels.push(`[${label}]`);
    prevEnd = clip.startTime + clip.duration;
  }

  // ── Audio from video clips ─────────────────────────────────────────────────
  for (let ci = 0; ci < videoClips.length; ci++) {
    const clip = videoClips[ci];
    const iIdx = inputIndex.get(clip.mediaId);
    if (iIdx === undefined) continue;

    const info = probeCache.get(clip.mediaId);
    if (!info?.hasAudio) continue; // skip if no audio stream

    const speed = Math.max(0.25, Math.min(4, clip.speed));
    const sourceDuration = clip.trimEnd - clip.trimStart;
    const delayMs = Math.round(clip.startTime * 1000);
    const label = `avc${ci}`;

    const tempoChain = atempoChain(speed);
    const afParts = [
      `atrim=start=${clip.trimStart.toFixed(6)}:duration=${sourceDuration.toFixed(6)}`,
      "asetpts=PTS-STARTPTS",
      tempoChain,
      `volume=${clip.volume.toFixed(4)}`,
      `adelay=${delayMs}|${delayMs}`,
    ].filter(Boolean);

    filters.push(`[${iIdx}:a]${afParts.join(",")}[${label}]`);
    audioMixLabels.push(`[${label}]`);
  }

  // ── Standalone audio clips ─────────────────────────────────────────────────
  for (let ci = 0; ci < audioOnlyClips.length; ci++) {
    const clip = audioOnlyClips[ci];
    const iIdx = inputIndex.get(clip.mediaId);
    if (iIdx === undefined) continue;

    const speed = Math.max(0.25, Math.min(4, clip.speed));
    const sourceDuration = clip.trimEnd - clip.trimStart;
    const delayMs = Math.round(clip.startTime * 1000);
    const label = `aonly${ci}`;

    const tempoChain = atempoChain(speed);
    const fadeIn = clip.fadeIn ?? 0;
    const fadeOut = clip.fadeOut ?? 0;
    const clipDur = clip.duration;
    const afParts = [
      `atrim=start=${clip.trimStart.toFixed(6)}:duration=${sourceDuration.toFixed(6)}`,
      "asetpts=PTS-STARTPTS",
      tempoChain,
      `volume=${clip.volume.toFixed(4)}`,
      fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : "",
      fadeOut > 0 ? `afade=t=out:st=${Math.max(0, clipDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : "",
      `adelay=${delayMs}|${delayMs}`,
    ].filter(Boolean);

    filters.push(`[${iIdx}:a]${afParts.join(",")}[${label}]`);
    audioMixLabels.push(`[${label}]`);
  }

  // ── Assemble concat and mix ────────────────────────────────────────────────

  const hasVideo = videoSegLabels.length > 0;
  const hasAudio = audioMixLabels.length > 0;

  if (hasVideo && videoSegLabels.length > 1) {
    filters.push(
      `${videoSegLabels.join("")}concat=n=${videoSegLabels.length}:v=1:a=0[vout]`
    );
  } else if (hasVideo) {
    filters.push(`${videoSegLabels[0]}null[vout]`);
  }

  if (hasAudio && audioMixLabels.length > 1) {
    filters.push(
      `${audioMixLabels.join("")}amix=inputs=${audioMixLabels.length}:duration=longest:normalize=0[aout]`
    );
  } else if (hasAudio) {
    filters.push(`${audioMixLabels[0]}anull[aout]`);
  }

  // ── Build final args ───────────────────────────────────────────────────────

  const outFile = "output.mp4";
  const args: string[] = [...inputArgs];

  if (filters.length > 0) {
    args.push("-filter_complex", filters.join(";"));
  }

  if (hasVideo) args.push("-map", "[vout]");
  if (hasAudio) args.push("-map", "[aout]");

  args.push(
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p"
  );

  if (hasAudio) {
    args.push("-c:a", "aac", "-ar", "44100", "-ac", "2");
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", outFile);

  onLog("Running ffmpeg…");
  onLog(`  Args: ${args.filter((a) => !a.startsWith("src_")).join(" ")}`);
  onProgress(35);

  const exitCode = await ffmpeg.exec(args);
  if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
  onProgress(90);

  onLog("Reading output…");
  const data = await ffmpeg.readFile(outFile);
  onProgress(95);

  // Cleanup
  for (const fname of fileNames.values()) {
    try { await ffmpeg.deleteFile(fname); } catch {}
  }
  try { await ffmpeg.deleteFile(outFile); } catch {}
  onProgress(100);
  onLog("Export done ✓");

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
}

// ─── Legacy smartStitch (kept for compatibility) ──────────────────────────────

export interface StitchOptions {
  files: File[];
  onLog: (msg: string) => void;
  onProgress: (pct: number) => void;
}

export async function smartStitch({ files, onLog, onProgress }: StitchOptions): Promise<Blob> {
  onLog("Loading ffmpeg.wasm…");
  const ffmpeg = await getFFmpeg(onLog);
  onProgress(5);

  const names: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = `input_${i}.mp4`;
    await ffmpeg.writeFile(name, await fetchFile(files[i]));
    names.push(name);
    onProgress(5 + (i + 1) * 5);
  }

  onLog("Probing…");
  const infos = await Promise.all(names.map((n) => probeFile(ffmpeg, n)));
  infos.forEach((info, i) =>
    onLog(`Video ${i + 1}: ${info.codec} ${info.width}×${info.height} @ ${info.fps}fps`)
  );
  onProgress(30);

  const ref = infos[0];
  const { w: outW, h: outH } = clampResolution(ref.width, ref.height);
  const anyAudio = infos.some((v) => v.hasAudio);
  const readyNames: string[] = [];

  for (let i = 0; i < names.length; i++) {
    const info = infos[i];
    const needsVideo = info.width !== outW || info.height !== outH || info.fps !== ref.fps;
    const needsAudio = anyAudio && !info.hasAudio;

    if (!needsVideo && !needsAudio && anyAudio && info.hasAudio) {
      readyNames.push(names[i]);
      onProgress(30 + ((i + 1) / names.length) * 50);
      continue;
    }

    const out = `norm_${i}.mp4`;
    const vf = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,fps=${ref.fps}`;

    const hasLavfi = anyAudio && !info.hasAudio;
    const args = hasLavfi
      ? ["-i", names[i], "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
         "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
         "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", out]
      : ["-i", names[i], "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
         ...(anyAudio ? ["-c:a", "aac", "-ar", "44100", "-ac", "2"] : ["-an"]), out];

    const exit = await ffmpeg.exec(args);
    if (exit !== 0) throw new Error(`Re-encode failed for video ${i + 1}`);
    readyNames.push(out);
    onProgress(30 + ((i + 1) / names.length) * 50);
  }

  const listContent = readyNames.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("list.txt", listContent);

  const concatExit = await ffmpeg.exec([
    "-f", "concat", "-safe", "0", "-i", "list.txt",
    "-c", "copy", "-reset_timestamps", "1", "-movflags", "+faststart", "output.mp4",
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
