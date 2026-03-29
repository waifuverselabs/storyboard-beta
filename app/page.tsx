"use client";

import { useCallback, useRef, useState } from "react";
import { smartStitch } from "@/lib/ffmpeg";
import styles from "./page.module.css";

type SlotState = "empty" | "loaded" | "processing";

interface VideoSlot {
  file: File | null;
  state: SlotState;
  preview: string | null;
}

const EMPTY_SLOT: VideoSlot = { file: null, state: "empty", preview: null };

export default function Home() {
  const [slots, setSlots] = useState<VideoSlot[]>([
    { ...EMPTY_SLOT },
    { ...EMPTY_SLOT },
    { ...EMPTY_SLOT },
  ]);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-80), msg]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const setSlotFile = (index: number, file: File) => {
    const preview = URL.createObjectURL(file);
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { file, state: "loaded", preview } : s))
    );
  };

  const clearSlot = (index: number) => {
    setSlots((prev) => {
      const old = prev[index];
      if (old.preview) URL.revokeObjectURL(old.preview);
      return prev.map((s, i) => (i === index ? { ...EMPTY_SLOT } : s));
    });
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      setSlotFile(index, file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (file) setSlotFile(index, file);
    e.target.value = "";
  };

  const filledCount = slots.filter((s) => s.file).length;
  const canStitch = filledCount >= 2 && phase === "idle";

  const handleStitch = async () => {
    const files = slots.filter((s) => s.file).map((s) => s.file!);
    if (files.length < 2) return;

    setPhase("working");
    setProgress(0);
    setLogs([]);
    setOutputUrl(null);

    try {
      const blob = await smartStitch({
        files,
        onLog: addLog,
        onProgress: setProgress,
      });

      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setPhase("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Error: ${msg}`);
      setPhase("error");
    }
  };

  const handleReset = () => {
    slots.forEach((s) => {
      if (s.preview) URL.revokeObjectURL(s.preview);
    });
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setSlots([{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }]);
    setLogs([]);
    setProgress(0);
    setPhase("idle");
    setOutputUrl(null);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <div className={styles.logoMark}>waifuverse</div>
          <h1 className={styles.title}>STORYBOARD PROTOTYPE</h1>
          <p className={styles.subtitle}>
            🧪 waifuverse labs · Client-side · Zero upload
          </p>
        </div>
      </header>

      {/* Drop zones */}
      <section className={styles.dropSection}>
        {slots.map((slot, i) => (
          <div key={i} className={styles.slotWrapper}>
            <div
              className={[
                styles.dropZone,
                slot.state === "loaded" ? styles.loaded : "",
                dragOver === i ? styles.dragOver : "",
                phase === "working" ? styles.disabled : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, i)}
              onClick={() =>
                phase === "idle" && fileInputRefs.current[i]?.click()
              }
            >
              <input
                type="file"
                accept="video/*"
                ref={(el) => { fileInputRefs.current[i] = el; }}
                onChange={(e) => handleFileInput(e, i)}
                style={{ display: "none" }}
              />

              {slot.preview ? (
                <div className={styles.preview}>
                  <video
                    src={slot.preview}
                    className={styles.previewVideo}
                    muted
                    playsInline
                    onMouseEnter={(e) =>
                      (e.target as HTMLVideoElement).play()
                    }
                    onMouseLeave={(e) => {
                      const v = e.target as HTMLVideoElement;
                      v.pause();
                      v.currentTime = 0;
                    }}
                  />
                  <div className={styles.previewOverlay}>
                    <span className={styles.fileName}>
                      {slot.file!.name.length > 20
                        ? slot.file!.name.slice(0, 18) + "…"
                        : slot.file!.name}
                    </span>
                    <span className={styles.fileSize}>
                      {formatBytes(slot.file!.size)}
                    </span>
                  </div>
                  {phase === "idle" && (
                    <button
                      className={styles.clearBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        clearSlot(i);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.slotNumber}>{i + 1}</div>
                  <div className={styles.dropIcon}>⬇</div>
                  <p className={styles.dropText}>Drop video or click</p>
                  <p className={styles.dropHint}>mp4 · mov · webm · mkv</p>
                </div>
              )}
            </div>

            {i < slots.length - 1 && (
              <div className={styles.plusDivider}>+</div>
            )}
          </div>
        ))}
      </section>

      {/* Controls */}
      <section className={styles.controls}>
        {phase === "idle" && (
          <>
            <button
              className={styles.stitchBtn}
              disabled={!canStitch}
              onClick={handleStitch}
            >
              {filledCount < 2
                ? `Add ${2 - filledCount} more video${2 - filledCount > 1 ? "s" : ""}`
                : `Stitch ${filledCount} videos →`}
            </button>
            {filledCount > 0 && (
              <button className={styles.resetBtn} onClick={handleReset}>
                Clear all
              </button>
            )}
          </>
        )}

        {phase === "working" && (
          <div className={styles.progressWrapper}>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressBar}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className={styles.progressLabel}>{progress}%</span>
          </div>
        )}

        {phase === "done" && outputUrl && (
          <div className={styles.doneControls}>
            <a
              href={outputUrl}
              download="stitched.mp4"
              className={styles.downloadBtn}
            >
              ↓ Download .mp4
            </a>
            <button className={styles.resetBtn} onClick={handleReset}>
              Start over
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className={styles.errorControls}>
            <span className={styles.errorBadge}>✕ Failed</span>
            <button className={styles.resetBtn} onClick={handleReset}>
              Try again
            </button>
          </div>
        )}
      </section>

      {/* Log */}
      {logs.length > 0 && (
        <section className={styles.logSection}>
          <div className={styles.logHeader}>
            <span>LOG</span>
            <span className={styles.logCount}>{logs.length} lines</span>
          </div>
          <div className={styles.logBody}>
            {logs.map((line, i) => (
              <div
                key={i}
                className={[
                  styles.logLine,
                  line.includes("Error") || line.includes("error")
                    ? styles.logError
                    : "",
                  line.includes("✓") ? styles.logSuccess : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className={styles.logPrompt}>›</span> {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        <span>All processing happens in your browser.</span>
        <span className={styles.dot}>·</span>
        <span>No files are uploaded anywhere.</span>
      </footer>
    </main>
  );
}
