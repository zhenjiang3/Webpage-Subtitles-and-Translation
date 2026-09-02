// apps/web/src/server/translator/.__sharp-shim__.cjs
/**
 * 为 @xenova/transformers 顶层 require('sharp') 准备的假模块。
 * 我们 V1 只做文本翻译，完全不会用到 xenova 的图像处理分支。
 * 此 shim 导出的构造函数/静态方法仅满足 RawImage.js 的顶层解析不崩；真正 new Sharp() 不会发生。
 *
 * 为什么需要这个：
 *   本项目之前用 --ignore-scripts 跳过了 sharp 的原生编译（sharp-win32-x64.node 缺失），
 *   导致 @xenova/transformers 的 pipelies.js 顶层 require('./RawImage') 时，RawImage.js 顶层
 *   require('sharp') 直接抛错，连创建翻译 pipeline 都进不去。
 *   用 Module._resolveFilename Hook 把 require('sharp') 重定向到本文件即可。
 */
'use strict';

function SharpShim() { /* 不会被真正构造（我们不处理图像） */ }

// RawImage.js 里会 new Sharp({ create: { width, height, channels, ... } })
// 以及 Sharp(imageBuffer).metadata().toColorspace(...).raw().toBuffer()
// 只要我们让它 new 不崩 + 返回的对象链式调用 each step return this，就能躲过去。
// 但为了稳妥：我们直接让每一次链式调用都 throw 一个清晰的错误，
//   这样如果未来真的走了图像处理路径，也不会 silent 失败。
const chainableStub = new Proxy(() => {}, {
  get(_, prop) {
    if (prop === 'then' || prop === 'catch' || prop === 'finally') {
      // 如果 await .toBuffer() / .metadata()，就返回一个 Promise，reject 给清晰错误
      return undefined; // 让它是 undefined，而不是 Promise，避免意外被 await
    }
    return function chainableCall() {
      const out = Object.create(
        Object.prototype,
        Object.getOwnPropertyDescriptors({
          toBuffer() {
            return Promise.reject(new Error('[sharp-shim] 走到了图像处理路径（toBuffer），但 V1 未启用 sharp。请联系开发者启用真实 sharp。'));
          },
          toFile() {
            return Promise.reject(new Error('[sharp-shim] 走到了图像处理路径（toFile），但 V1 未启用 sharp。请联系开发者启用真实 sharp。'));
          },
          metadata() {
            return Promise.reject(new Error('[sharp-shim] 走到了图像处理路径（metadata），但 V1 未启用 sharp。请联系开发者启用真实 sharp。'));
          },
          clone() { return chainableStub; },
          pipe() { return chainableStub; },
        }),
      );
      // 为了 new Sharp(...) 返回一个「所有 undefined 属性/方法都返回自己」的 Proxy
      return chainableStub;
    };
  },
  apply() { return chainableStub; },
  construct() { return chainableStub; },
});

// Export 两种：默认函数构造 + named statics（sharp.concurrency / sharp.versions 等）
function sharpConstructor() { return chainableStub; }
sharpConstructor.Sharp = SharpShim;
sharpConstructor.default = sharpConstructor;
sharpConstructor.concurrency = () => 1;
sharpConstructor.counters = () => ({});
sharpConstructor.simd = function simd() { return sharpConstructor; };
sharpConstructor.cache = function cache() { return sharpConstructor; };
sharpConstructor.queue = function queue() { return {}; };
sharpConstructor.versions = {
  libvips: '0.0.0-shim',
  sharp: '0.32.6-shim',
};

// 兼容 RawImage.js 顶层写法：const sharp = require('sharp'); const s = sharp(buffer)
module.exports = sharpConstructor;
module.exports.default = sharpConstructor;
module.exports.Sharp = SharpShim;
