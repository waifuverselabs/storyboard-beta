/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  // Required for ffmpeg.wasm SharedArrayBuffer support
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },

  webpack: (config) => {
    // Stub server-only / native packages
    config.resolve.alias = {
      ...config.resolve.alias,
      // Point these packages at their browser-only bundles
      "@huggingface/transformers": path.resolve(
        __dirname,
        "node_modules/@huggingface/transformers/dist/transformers.web.js"
      ),
      "kokoro-js": path.resolve(
        __dirname,
        "node_modules/kokoro-js/dist/kokoro.web.js"
      ),
      // Use the WASM-only ESM bundle. Unlike ort.bundle.min.mjs, this bundle does
      // NOT load ort-wasm-simd-threaded.jsep.mjs (WebGPU/JSEP) at startup — it
      // loads only ort-wasm-simd-threaded.mjs (plain WASM). We don't need JSEP
      // since we run in WASM mode (numThreads:1). Both the bare import and the
      // /webgpu subpath alias here so @huggingface/transformers (which imports
      // onnxruntime-web/webgpu) and our direct import share ONE singleton.
      "onnxruntime-web$": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs"
      ),
      "onnxruntime-web/webgpu": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs"
      ),
      "onnxruntime-node$": false,
      "sharp$": false,
    };

    // kokoro.web.js (and the ort bundles it embeds) use `import.meta` which SWC
    // rejects when minifying CJS output. Strip import.meta before bundling.
    // Strip import.meta from all pre-bundled browser bundles before SWC sees them.
    // SWC rejects import.meta when minifying webpack's CJS output chunks.
    const stripImportMetaLoader = path.resolve(__dirname, "lib/strip-import-meta-loader.js");
    config.module.rules.push({
      test: /node_modules[\\/](kokoro-js[\\/]dist[\\/]kokoro\.web\.js|@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js|onnxruntime-web[\\/]dist[\\/]ort\.wasm\.bundle\.min\.mjs)$/,
      use: [{ loader: stripImportMetaLoader }],
    });

    // Make /ort-wasm/*.mjs importable as webpack modules: resolve absolute-path
    // imports against public/ so webpack can find and bundle the WASM glue files
    // if webpackIgnore magic comments are stripped during bundling.
    config.resolve.roots = [
      ...(config.resolve.roots ?? []),
      path.resolve(__dirname, "public"),
    ];
    config.module.rules.push({
      test: /public[\\/]ort-wasm[\\/].*\.mjs$/,
      use: [{ loader: stripImportMetaLoader }],
    });

    // kokoro.web.js references ort.bundle.min.mjs only as a Worker URL (file:// path
    // only, never reached in production). Treat the kokoro copy as a file asset.
    config.module.rules.push({
      test: /kokoro-js[\\/]dist[\\/]ort\.bundle\.min\.mjs$/,
      type: "asset/resource",
      generator: { filename: "static/chunks/[name][ext]" },
    });

    // Enable async WebAssembly (used by onnxruntime-web WASM backend)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

module.exports = nextConfig;
