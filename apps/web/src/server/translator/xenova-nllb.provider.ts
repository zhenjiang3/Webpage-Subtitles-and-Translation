/**
 * 本地离线 NLLB-200 翻译提供者（方案 A：零 API Key + 零 Python）
 * —— 基于 @xenova/transformers（ONNX Runtime Web / Node），单模型覆盖 200+ 语言
 * 模型：Xenova/nllb-200-distilled-600M（Meta NLLB-200 600M 参数蒸馏版，int8 量化 ONNX，~900MB）
 *   - 首次运行自动从 HuggingFace CDN 下载并缓存到系统（~/.cache/huggingface 或 node_modules/.cache）
 *   - 后续调用永久离线复用，无需网络
 * 语言对（V1 全覆盖）：中 ↔ 英、中 ↔ 日、英 ↔ 日，以及中间语言自动处理
 * 文档：https://huggingface.co/Xenova/nllb-200-distilled-600M
 */
import type { LanguageCode } from '@/lib/types';
import type { TranslateBatchInput, TranslatorProvider } from './types';

// NLLB-200 / FLORES-200 语言标记（3 字脚本标签）
// 完整列表：https://github.com/facebookresearch/flores/blob/main/flores200/README.md#languages-in-flores-200
const NLLB_LANG_TAG: Record<LanguageCode, string> = {
  zh: 'zho_Hans', // 中文简体
  en: 'eng_Latn', // 英语（拉丁）
  ja: 'jpn_Jpan', // 日语（日文汉字+假名）
};

const MODEL_ID = 'Xenova/nllb-200-distilled-600M';
/** 模型推荐一次批量 ≤15 条，避免 Node 堆内存爆掉或 ONNX OOM */
export const XENOVA_MAX_BATCH = 15;
/**
 * @xenova/transformers pipeline() 返回类型 —— 动态加载，避免 TS 类型绑定版本冲突
 *   （any 在此文件范围内已足够安全，实际调用参数仅 translate(src_lang/tgt_lang)，结构简单）
 */
type XenovaPipelineFn = any;
type XenovaTransformersMod = any;

let cachedModPromise: Promise<XenovaTransformersMod> | null = null;
let cachedPipelinePromise: Promise<XenovaPipelineFn> | null = null;

/**
 * 向上回溯 markers 命中的项目根（不依赖 Webpack __dirname / process.cwd()）。
 * 返回绝对路径。优先命中 markers 数量 ≥2 的目录。
 */
function resolveProjectRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const NodeFs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const NodePath = require('node:path') as typeof import('node:path');
  const cwd = process.cwd();
  const markers = ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package.json', '.git', 'apps', 'data'];
  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    let hit = 0;
    for (const m of markers) {
      try { if (NodeFs.existsSync(NodePath.join(dir, m))) hit++; } catch { /* noop */ }
    }
    if (hit >= 2) return dir;
    const parent = NodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

/**
 * 解析「项目下 apps/web/tools/shim/sharp.cjs」真实存在的绝对路径。
 * 找不到时写临时文件到 .next/shims/sharp.cjs 并返回那条路径（终极兜底）。
 * 不在 Hook 里 new Module / 不动 prototype.load，避免 Next webpack 两套 Module 原型引用不同
 *   导致 instanceof 报错：TypeError: The "mod" argument must be an instance of Module. Received an instance of Module。
 */
function resolveSharpShim(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const NodeFs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const NodePath = require('node:path') as typeof import('node:path');
  const root = resolveProjectRoot();
  const candidates: string[] = [];

  candidates.push(NodePath.join(root, 'apps/web/tools/shim/sharp.cjs'));
  candidates.push(NodePath.join(root, 'tools/shim/sharp.cjs'));
  candidates.push(NodePath.join(root, 'apps/web/src/server/translator/.__sharp-shim__.cjs'));

  if (typeof __filename === 'string') {
    let d = NodePath.dirname(__filename);
    for (let i = 0; i < 6; i++) {
      const base = NodePath.basename(d);
      if (base === 'web') {
        candidates.push(NodePath.join(d, 'tools/shim/sharp.cjs'));
        candidates.push(NodePath.join(d, 'src/server/translator/.__sharp-shim__.cjs'));
        break;
      }
      const parent = NodePath.dirname(d);
      if (parent === d) break;
      d = parent;
    }
  }

  for (const c of candidates) {
    try { if (NodeFs.existsSync(c)) return c; } catch { /* noop */ }
  }

  // 写临时文件
  const shimDir = NodePath.join(root, '.next', 'shims');
  try { NodeFs.mkdirSync(shimDir, { recursive: true }); } catch { /* noop */ }
  const dst = NodePath.join(shimDir, 'sharp.cjs');
  const SQ = "'";
  const L: string[] = [];
  L.push(SQ + 'use strict' + SQ + ';');
  L.push('// Sharp shim auto-generated at runtime (V1 text-only path).');
  L.push('// Xenova 顶层 require(' + SQ + 'sharp' + SQ + ') 时使用，避免因 sharp 原生二进制缺失炸 import。');
  L.push('function createChainable() {');
  L.push('  var base = Object.create(null);');
  L.push('  base.toBuffer = function () { return Promise.reject(new Error(' + SQ + '[sharp-shim] toBuffer called, enable real sharp.' + SQ + ')); };');
  L.push('  base.toFile   = function () { return Promise.reject(new Error(' + SQ + '[sharp-shim] toFile called, enable real sharp.' + SQ + ')); };');
  L.push('  base.metadata = function () { return Promise.reject(new Error(' + SQ + '[sharp-shim] metadata called, enable real sharp.' + SQ + ')); };');
  L.push('  base.clone = function () { return this; };');
  L.push('  base.pipe  = function () { return this; };');
  L.push('  return new Proxy(base, {');
  L.push('    get: function (t, p, r) {');
  L.push('      var k = String(p);');
  L.push('      if (k === ' + SQ + 'then' + SQ + ' || k === ' + SQ + 'catch' + SQ + ' || k === ' + SQ + 'finally' + SQ + ') return undefined;');
  L.push('      if (Object.prototype.hasOwnProperty.call(t, k)) return Reflect.get(t, k, r);');
  L.push('      return function () { return createChainable(); };');
  L.push('    }');
  L.push('  });');
  L.push('}');
  L.push('function sharpConstructor() { return createChainable(); }');
  L.push('sharpConstructor.Sharp = function () { return sharpConstructor.apply(null, arguments); };');
  L.push('sharpConstructor.default = sharpConstructor;');
  L.push('sharpConstructor.concurrency = function (n) { return n === undefined ? 1 : sharpConstructor; };');
  L.push('sharpConstructor.counters    = function ()  { return { process: 0, queue: 0 }; };');
  L.push('sharpConstructor.simd        = function ()  { return sharpConstructor; };');
  L.push('sharpConstructor.cache       = function (v) { return v === undefined ? { memory: 0, files: 0, items: 0 } : sharpConstructor; };');
  L.push('sharpConstructor.queue       = function ()  { return 0; };');
  L.push('sharpConstructor.versions    = { libvips: ' + SQ + '0.0.0-shim' + SQ + ', sharp: ' + SQ + '0.32.6-shim' + SQ + ', vips: ' + SQ + '0.0.0-shim' + SQ + ' };');
  L.push('sharpConstructor.format      = Object.freeze({ jpeg: { id: ' + SQ + 'jpeg' + SQ + ' }, png: { id: ' + SQ + 'png' + SQ + ' }, webp: { id: ' + SQ + 'webp' + SQ + ' }, avif: { id: ' + SQ + 'avif' + SQ + ' }, gif: { id: ' + SQ + 'gif' + SQ + ' }, tiff: { id: ' + SQ + 'tiff' + SQ + ' } });');
  L.push('module.exports = sharpConstructor;');
  L.push('module.exports.default = sharpConstructor;');
  L.push('module.exports.Sharp = sharpConstructor.Sharp;');

  try { NodeFs.writeFileSync(dst, L.join(require('node:os').EOL), 'utf8'); } catch { /* noop */ }
  try { if (NodeFs.existsSync(dst)) return dst; } catch { /* noop */ }

  throw new Error(
    '[xenova-nllb] 无法定位 sharp shim 文件，且无法写入 .next/shims/sharp.cjs 临时文件。\n' +
      '候选路径：\n  - ' + candidates.join('\n  - '),
  );
}

function loadTransformers(): Promise<XenovaTransformersMod> {
  if (cachedModPromise) return cachedModPromise;

  // 安装一次性 Hook：仅重写 Module._resolveFilename，遇到 require('sharp') 直接返回磁盘真实存在的
  // sharp shim .cjs 路径，让 Node/Next 正常 CJS require 它，完全不 new Module，不覆盖 prototype.load。
  (globalThis as unknown as { __XENOVA_NLLB_SHARP_SHIM_INSTALLED__?: boolean }).__XENOVA_NLLB_SHARP_SHIM_INSTALLED__ ??= (() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as typeof import('node:module') & {
      _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
    };
    const origResolve = NodeModule._resolveFilename.bind(NodeModule);
    const shimPath = resolveSharpShim();
    NodeModule._resolveFilename = function xenovaSharpShimResolve(request, parent, isMain, options) {
      if (request === 'sharp') return shimPath;
      return origResolve(request, parent, isMain, options);
    };
    return true;
  })();

  // eslint-disable-next-line no-console
  console.log('[xenova-nllb] 开始加载 @xenova/transformers（第一次需 1-10 秒）...');

  cachedModPromise = import('@xenova/transformers')
    .then((mod) => {
      // eslint-disable-next-line no-console
      console.log('[xenova-nllb] @xenova/transformers 加载成功。');
      return mod;
    })
    .catch((e) => {
      cachedModPromise = null;
      const msg =
        '[xenova-nllb] 无法加载 @xenova/transformers，请确认已安装依赖：\n' +
        '  pnpm --filter @app/web add @xenova/transformers\n' +
        '  （若报错仍指向 sharp-win32-x64.node：在 PowerShell 新窗口执行 rebuild sharp 命令）\n' +
        '原始错误：' + ((e as Error).message ?? String(e)) + '\n' +
        (e instanceof Error && e.stack ? '调用栈：\n' + e.stack + '\n' : '');
      throw new Error(msg);
    });
  return cachedModPromise;
}

/** 单例懒加载 pipeline（同一个 pipeline 内 ONNX session 会复用，避免重复创建 ~30s 开销） */
async function getPipeline(): Promise<XenovaPipelineFn> {
  if (cachedPipelinePromise) return cachedPipelinePromise;
  cachedPipelinePromise = (async () => {
    const mod = await loadTransformers();
    // pipeline(task, modelId, opts?)
    // @xenova/transformers v2 API：返回 Promise<Pipeline>
    // 对于 translation 任务，返回 TranslationPipeline
    // 不要开 quantized=false，quantized=int8 正是我们要的（省显存/内存 4×，精度几乎不损失）
    const pipe = await mod.pipeline('translation', MODEL_ID, {
      // 建议缓存到项目根目录的 .cache，避免 Node 全局权限问题和多用户污染
      cache_dir: process.env.XENOVA_CACHE_DIR ?? undefined,
      // 不强制下载；本地已有就用本地
      local_files_only: false,
      dtype: 'q8', // int8 量化（默认可能是 fp16，q8 更适合 CPU + 内存受限）
    } as object);
    return pipe;
  })().catch((e) => {
    cachedPipelinePromise = null;
    throw e;
  });
  return cachedPipelinePromise;
}

/**
 * 小批量推理（防止内存/显存爆）
 * 内部会将 texts 按 XENOVA_MAX_BATCH 分 slice 并行数 1 推理
 */
async function translateSlice(
  pipe: XenovaPipelineFn,
  texts: string[],
  srcTag: string,
  tgtTag: string,
): Promise<string[]> {
  if (texts.length === 0) return [];
  if (texts.every((t) => !t || t.trim().length === 0)) {
    return texts.map((t) => t); // 空 cue 直接返回，节省推理
  }

  const results: string[] = [];
  for (let i = 0; i < texts.length; i += XENOVA_MAX_BATCH) {
    const batch = texts.slice(i, i + XENOVA_MAX_BATCH);
    // 空 cue 占位 → 推理后按位置回填（避免空串给模型导致 <unk> 泛滥）
    const indices: number[] = [];
    const nonEmpty: string[] = [];
    batch.forEach((t, idx) => {
      if (t && t.trim().length > 0) {
        indices.push(idx);
        nonEmpty.push(t);
      }
    });

    let translated: string[] = new Array(batch.length).fill('');
    if (nonEmpty.length > 0) {
      // Xenova TranslationPipeline 输出格式：
      //   string in → { translation_text: string }
      //   string[] in → Array<{ translation_text: string }>
      const raw = await pipe(nonEmpty.length === 1 ? nonEmpty[0]! : nonEmpty, {
        src_lang: srcTag,
        tgt_lang: tgtTag,
        // max_new_tokens: 原句一般 1-2 行字幕，默认够，但放宽到 256 保险
        max_new_tokens: 256,
        do_sample: false, // 贪心解码，字幕翻译要求确定性
      } as object);
      const arr = Array.isArray(raw) ? raw : [raw];
      const outTexts = arr.map((r: { translation_text?: string }) => r?.translation_text ?? '');
      // 回填到对应位置
      indices.forEach((origIdx, j) => {
        translated[origIdx] = outTexts[j] ?? batch[origIdx] ?? '';
      });
    }
    results.push(...translated);
  }
  // 翻译后简单清洗：NLLB 偶尔会把全角半角空格乱加，去掉 trailing \u2581 等奇怪 token 字符
  return results.map((t) =>
    (t ?? '')
      .replace(/\u2581/g, ' ') // SentencePiece underscore token
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export class XenovaNllbTranslatorProvider implements TranslatorProvider {
  readonly name = 'xenova-nllb';
  /** 单例预热（可选）：构造函数阶段就启动 pipeline 加载，真正翻译时更快 */
  private readonly warmup: Promise<void>;

  constructor() {
    // 不提前抛错，等第一次翻译时再抛，避免 Next.js 启动时就因缺包卡死首页渲染
    this.warmup = getPipeline().then(() => undefined);
  }

  async translate(input: TranslateBatchInput): Promise<string[]> {
    const { sourceLang, targetLang, texts } = input;
    if (sourceLang === targetLang) return texts.map((t) => t ?? '');
    if (texts.length === 0) return [];

    const srcTag = NLLB_LANG_TAG[sourceLang];
    const tgtTag = NLLB_LANG_TAG[targetLang];
    if (!srcTag || !tgtTag) {
      throw new Error(
        `[xenova-nllb] 不支持的语言对：${sourceLang} → ${targetLang}（V1 仅支持 zh/en/ja）`,
      );
    }

    // 等待 pipeline 初始化（首次 ~30s-3min，取决于网络和磁盘）
    let pipe: XenovaPipelineFn;
    try {
      pipe = await Promise.race([
        getPipeline(),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(
              new Error(
                `[xenova-nllb] pipeline 初始化超时（首次启动需下载模型 ~900MB，请耐心等待或检查网络）。` +
                  `\n可提前运行如下命令做预热：node -e "import('@xenova/transformers').then(m=>m.pipeline('translation','${MODEL_ID}').then(()=>console.log('OK')))"`,
              ),
            );
          }, 10 * 60 * 1000),
        ),
      ]);
    } catch (e) {
      void this.warmup; // 让 warmup 继续走（不阻断）
      throw e;
    }

    // 全量按 slice 分批翻译
    const out = await translateSlice(pipe, texts, srcTag, tgtTag);

    // 长度兜底：NLLB 偶尔因为超长输入导致整条丢失，这里按原文回填
    if (out.length !== texts.length) {
      const padded = new Array(texts.length).fill('');
      for (let i = 0; i < Math.min(out.length, texts.length); i++) {
        padded[i] = out[i] ?? texts[i] ?? '';
      }
      for (let i = out.length; i < texts.length; i++) {
        padded[i] = texts[i] ?? '';
      }
      return padded;
    }

    // 对于空 cue 翻译后空白的，保留原文避免空字符串在编辑器里显得像"丢翻译"
    return out.map((t, i) => (t.length === 0 && (texts[i] ?? '').length > 0 ? (texts[i] as string) : t));
  }
}

/**
 * 对外批量工具 —— 直接复用 xenova slice 的 15 条分片（不要再套 50 条）
 * 但为了保持 scheduler 里 translateInBatches 的 100% 兼容（它按 50 条分片 + 进度），
 * 我们允许它继续分片；translateInBatches 传进来的每一批 ≤50，
 * XenovaNllbTranslatorProvider.translate 内部再按 15 条一小片跑就行，内存无压力。
 */
export const XENOVA_BATCH_SIZE = 50; // 给 translateInBatches 用；内部还会 15 条微批
