/**
 * Webpack loader: replaces `import.meta` with a plain object so SWC/Terser
 * can minify the file without rejecting ESM-only syntax in CJS output.
 * `import.meta.url` → a safe https:// string so any file:// guards
 * in onnxruntime evaluate to false (preventing sub-worker spawning).
 */
module.exports = function (source) {
  return source.replace(/import\.meta/g, '({url:"https://"})');
};
