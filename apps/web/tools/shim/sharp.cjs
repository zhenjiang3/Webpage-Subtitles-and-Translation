// apps/web/tools/shim/sharp.cjs
/**
 * Sharp 模块占位实现（Zero-API 方案 A 专用）
 * --------------------------------------------
 * V1 仅做文本翻译（NLLB-200 纯文本），不使用 @xenova/transformers 的图像流水线。
 * 但 Xenova 的入口（pipelines.js -> RawImage.js）在顶层 require('sharp')，会触发
 * sharp 的原生二进制加载（sharp-win32-x64.node）。
 *
 * 因为项目安装时用过 `pnpm install --ignore-scripts`，sharp 的原生二进制没有被
 * prebuild-install 下载（需要联网 + 非 MITM），导致 sharp-win32-x64.node 缺失，
 * 进而 require('sharp') 第一行就崩，连翻译 pipeline 都进不去。
 *
 * 修复策略：
 *   通过 Node Module._resolveFilename Hook，把 require('sharp') 重定向到本文件，
 *   而 Xenova 绝不会真正 new Sharp(buffer).toBuffer(...) 这类图像处理 API，
 *   所以这个占位文件足够用。如果未来走了图像处理路径，这里会拒绝并抛出清晰错误。
 */
'use strict';

// 构造一个「链式调用永远返回自身」的实例，满足：
//   new Sharp(buf).rotate(90).resize(32,32).extract(...).raw().toBuffer()
// 这种形式不崩（虽然 toBuffer 到时候会抛）
function createChainable(customMethods) {
  const base = Object.assign(Object.create(null), customMethods || {});
  const proxy = new Proxy(base, {
    get(t, prop, rcv) {
      const k = String(prop);
      if (k === 'then' || k === 'catch' || k === 'finally') {
        // 避免被误当成 Promise
        return undefined;
      }
      if (Object.prototype.hasOwnProperty.call(t, k)) {
        return Reflect.get(t, k, rcv);
      }
      return function stubChain() { return proxy; };
    },
  });
  return proxy;
}

function sharpConstructor() {
  const stubInst = createChainable({
    toBuffer() {
      return Promise.reject(new Error('[sharp-shim] 代码路径走到了 sharp.toBuffer，但 V1 未启用真实 sharp 原生二进制。请联系开发者启用真实 sharp（rebuild sharp@0.32.6）。'));
    },
    toFile() {
      return Promise.reject(new Error('[sharp-shim] 代码路径走到了 sharp.toFile，但 V1 未启用真实 sharp 原生二进制。请联系开发者启用真实 sharp（rebuild sharp@0.32.6）。'));
    },
    metadata() {
      return Promise.reject(new Error('[sharp-shim] 代码路径走到了 sharp.metadata，但 V1 未启用真实 sharp 原生二进制。请联系开发者启用真实 sharp（rebuild sharp@0.32.6）。'));
    },
    stats() {
      return Promise.reject(new Error('[sharp-shim] stats，请联系开发者启用真实 sharp。'));
    },
    clone() { return this; },
    pipe() { return this; },
    arrayBuffer() {
      return Promise.reject(new Error('[sharp-shim] arrayBuffer，请联系开发者启用真实 sharp。'));
    },
    // Sharp 的 Buffer 输入模式：await sharp(buffer).toBuffer() 返回 Promise<Buffer>
    // 但一旦有人真的写了 await sharp(buffer)，await 会等待对象属性「本身是否 thenable」，
    // 所以我们不在 stubInst 上挂 .then（上面 Proxy 会 return undefined）——
    // 这样 await sharp(buffer) 会返回 chainable 本身，不会卡死。
  });
  return stubInst;
}

// 顶层 API：
//   - const sharp = require('sharp')
//   - const s = sharp(buffer, opts?)
//   - sharp.concurrency(...) / sharp.cache(...) / sharp.queue()
//   - sharp.simd(bool?) returns sharp 构造函数本身
sharpConstructor.Sharp = function SharpCtor() { return sharpConstructor.apply(void 0, arguments); };
sharpConstructor.default = sharpConstructor;
sharpConstructor.concurrency = function concurrency(n) { if (n !== undefined) return sharpConstructor; return 1; };
sharpConstructor.counters = function counters() { return { process: 0, queue: 0 }; };
sharpConstructor.simd = function simd() { return sharpConstructor; };
sharpConstructor.cache = function cacheFn(memoryOrOptions) { if (memoryOrOptions === undefined) return { memory: 0, files: 0, items: 0 }; return sharpConstructor; };
sharpConstructor.queue = function queue() { return 0; };
sharpConstructor.versions = {
  libvips: '0.0.0-shim',
  sharp: '0.32.6-shim',
  vips: '0.0.0-shim',
};
// Xenova 的 RawImage.js 会访问 sharp.format 对象
sharpConstructor.format = Object.freeze({
  jpeg: { id: 'jpeg' },
  png: { id: 'png' },
  webp: { id: 'webp' },
  avif: { id: 'avif' },
  gif: { id: 'gif' },
  tiff: { id: 'tiff' },
});

module.exports = sharpConstructor;
// ESM interop 兼容（import sharp from 'sharp' → default export）
module.exports.default = sharpConstructor;
module.exports.Sharp = sharpConstructor.Sharp;
