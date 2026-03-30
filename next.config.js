/** @type {import('next').NextConfig} */
const path = require("path");
const webpack = require("webpack");

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
      "onnxruntime-node$": false,
      "sharp$": false,
    };

    // The ort JS bundles use `import.meta` which Terser can't minify.
    // Stub them all out — we only use the WASM backend at runtime.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /ort(\.[a-z.]+)?\.bundle\.min\.mjs$/,
        path.resolve(__dirname, "lib/stub.js")
      )
    );

    // Enable async WebAssembly (used by onnxruntime-web WASM backend)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

module.exports = nextConfig;
