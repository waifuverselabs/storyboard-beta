# Video Stitcher

Drag-and-drop video stitcher that runs entirely in the browser — no server, no uploads.  
Built with Next.js + ffmpeg.wasm. Deploys to Vercel in one click.

## How it works

**All processing is client-side.** ffmpeg is compiled to WebAssembly and runs inside the browser.  
Files never leave the user's device. Vercel only serves the static app shell.

Pipeline:
1. User drops 2–3 videos into the slots
2. Each video is probed (codec, resolution, fps) using `ffmpeg -i`
3. If all match → fast copy concat (no re-encode, instant)
4. If they differ → only mismatched files are re-encoded to match the first video, then concat
5. Output is downloaded directly from the browser

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

That's it. `vercel.json` and `next.config.js` both set the required headers.

## Required headers (why)

ffmpeg.wasm uses `SharedArrayBuffer` for multi-threading, which requires cross-origin isolation:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are set in both `next.config.js` (dev) and `vercel.json` (production CDN layer).

## File size limits

Processing happens in browser memory. Practical limits depend on the user's RAM:
- Works well up to ~500MB per file on modern machines
- For very large files (4K, long clips), use the desktop Python version instead

## Tech

- Next.js 14 App Router
- `@ffmpeg/ffmpeg` v0.12 (WebAssembly, single-threaded build for max compatibility)
- CDN: JSDelivr (has correct `Cross-Origin-Resource-Policy: cross-origin` headers, unlike unpkg)
- Zero backend, zero database, zero cost
