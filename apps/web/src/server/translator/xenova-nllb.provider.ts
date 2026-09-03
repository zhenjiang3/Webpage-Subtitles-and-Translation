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
 * 加载 @xenova/transformers（单例懒加载）。
 *
 * 📌 Sharp 原生二进制缺失的问题在「包解析层」已根治：
 *    根 package.json 配置了 pnpm.overrides → sharp 全树替换为 workspace 包 @app/sharp-shim
 *    （packages/sharp-shim/index.cjs），无论 ESM `import sharp from 'sharp'`
 *    还是 CJS `require('sharp')`，都会命中 stub，不会再抛 sharp-win32-x64.node 缺失。
 *    因此本函数不再需要 Module._resolveFilename hook / 动态写 shim 等运行时兜圈子逻辑。
 */
function loadTransformers(): Promise<XenovaTransformersMod> {
  if (cachedModPromise) return cachedModPromise;

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
