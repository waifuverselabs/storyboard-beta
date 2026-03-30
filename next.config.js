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
      // Point @huggingface/transformers at the browser-only bundle
      "@huggingface/transformers": path.resolve(
        __dirname,
        "node_modules/@huggingface/transformers/dist/transformers.web.js"
      ),
      "onnxruntime-node$": false,
      "sharp$": false,
    };

    // The ort WebGPU bundle uses `import.meta` which Terser can't minify.
    // Replace it with an empty stub — we only use the WASM backend.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /ort\.webgpu\.bundle\.min\.mjs$/,
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
