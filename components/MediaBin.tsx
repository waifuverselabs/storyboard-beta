"use client";

import { useRef } from "react";
import type { MediaItem } from "@/lib/types";
import { formatDuration } from "@/lib/mediaUtils";

interface MediaBinProps {
  items: MediaItem[];
  onAddToTimeline: (item: MediaItem) => void;
  onRemove: (id: string) => void;
  onImport: (files: FileList) => void;
  draggingMediaId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

export default function MediaBin({
  items,
  onAddToTimeline,
  onRemove,
  onImport,
  draggingMediaId,
  onDragStart,
  onDragEnd,
}: MediaBinProps) {
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="media-bin">
      <div className="media-bin-header">
        <span>Media</span>
        <button
          className="media-bin-import"
          onClick={() => importRef.current?.click()}
        >
          + Import
        </button>
        <input
          ref={importRef}
          type="file"
          accept="video/*,audio/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) {
              onImport(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      <div className="media-bin-list">
        {items.length === 0 ? (
          <div className="media-bin-empty">
            <div className="media-bin-empty-icon">🎬</div>
            <p>Drop video or audio<br />files here to import</p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="media-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("mediaId", item.id);
                e.dataTransfer.effectAllowed = "copy";
                onDragStart(item.id);
              }}
              onDragEnd={onDragEnd}
              style={{ opacity: draggingMediaId === item.id ? 0.5 : 1 }}
              title={`${item.name} (${formatDuration(item.duration)})`}
            >
              <div className="media-item-thumb">
                {item.kind === "video" ? (
                  item.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnail} alt={item.name} />
                  ) : (
                    "🎥"
                  )
                ) : (
                  "🎵"
                )}
              </div>

              <div className="media-item-info">
                <div className="media-item-name">{item.name}</div>
                <div className="media-item-meta">
                  {item.kind === "video"
                    ? `${item.width}×${item.height} · `
                    : ""}
                  {formatDuration(item.duration)}
                </div>
              </div>

              <button
                className="media-item-add"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToTimeline(item);
                }}
                title="Add to timeline"
              >
                +
              </button>

              <button
                className="media-item-del"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
                title="Remove from bin"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
