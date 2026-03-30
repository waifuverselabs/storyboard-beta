/**
 * Webpack loader: replaces `import.meta` with a plain object so SWC/Terser
 * can minify the file without rejecting ESM-only syntax in CJS output.
 *
 * Also patches kokoro.web.js's bundled ort env to force single-threaded WASM
 * (numThreads:1) and explicit wasmPaths. Without this, kokoro's internal ort
 * defaults to multi-threaded mode, spawning WASM workers via blob URLs which
 * webpack cannot resolve at runtime.
 */
module.exports = function (source) {
  let result = source.replace(/import\.meta/g, '({url:""})');

  // Patch the ort env object bundled inside kokoro.web.js.
  // The pattern `wasm:{},webgl:{},webgpu:{}` appears exactly once and is the
  // ort-common env initializer. Injecting numThreads:1 prevents ort from
  // spawning threaded WASM workers (blob URLs) inside our audio worker.
  if (this.resourcePath && this.resourcePath.includes('kokoro')) {
    // Replace ALL occurrences — kokoro.web.js bundles two ort-common instances
    // (main + worker scope). String.replace() only patches the first; the second
    // would keep numThreads at its default (>1) and spawn blob-URL pthread workers.
    result = result.replaceAll(
      'wasm:{},webgl:{},webgpu:{}',
      'wasm:{proxy:false,numThreads:1,wasmPaths:"/ort-wasm/"},webgl:{},webgpu:{}'
    );
  }

  return result;
};
