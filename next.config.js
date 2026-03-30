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
      // Use the CJS bundle — zero import.meta, initialises ort.env.wasm correctly.
      // Both the bare import and the /webgpu subpath alias to the same module so
      // that @huggingface/transformers (which imports onnxruntime-web/webgpu) and
      // our direct import share the SAME singleton — one config call covers both.
      "onnxruntime-web$": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.min.js"
      ),
      "onnxruntime-web/webgpu": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.min.js"
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
      test: /node_modules[\\/](kokoro-js[\\/]dist[\\/]kokoro\.web\.js|@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js)$/,
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
