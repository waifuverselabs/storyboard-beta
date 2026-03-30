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

  if (this.resourcePath && this.resourcePath.includes('kokoro')) {
    // Patch the ort env object bundled inside kokoro.web.js.
    // Replace ALL occurrences — kokoro.web.js bundles two ort-common instances
    // (main + worker scope). String.replace() only patches the first; the second
    // would keep numThreads at its default (>1) and spawn blob-URL pthread workers.
    result = result.replaceAll(
      'wasm:{},webgl:{},webgpu:{}',
      'wasm:{proxy:false,numThreads:1,wasmPaths:"/ort-wasm/"},webgl:{},webgpu:{}'
    );

    // Add webpackIgnore to the generic ort WASM module importer so that
    // runtime-computed URLs like /ort-wasm/ort-wasm-simd-threaded.jsep.mjs
    // are fetched natively by the browser instead of going through webpack's
    // __webpack_require__ (which cannot resolve runtime-only paths).
    result = result.replace(
      'async e=>(await import(e)).default',
      'async e=>(await import(/* webpackIgnore: true */ e)).default'
    );
  }

  return result;
};
