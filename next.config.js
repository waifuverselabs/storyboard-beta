/** @type {import('next').NextConfig} */
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
    // Stub out server-only / native packages that @xenova/transformers
    // optionally depends on — they are not needed in the browser.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node$": false,
      "sharp$": false,
    };
    // Enable async WebAssembly (used by onnxruntime-web WASM backend)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

module.exports = nextConfig;
