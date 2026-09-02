/**
 * whisper.cpp 本地 ASR 提供者（方案 A：零 API Key + 零 Python）
 * —— 调用 Windows 预编译的 whisper-cli.exe（C++），CPU 跑 ggml 量化模型
 * 官网：https://github.com/ggml-org/whisper.cpp
 * Windows 部署：
 *   1. 从 GitHub Releases 下载 whisper-bin-x64.zip → 解压（含 whisper-cli.exe + *.dll）
 *   2. 从 HuggingFace 下载 ggml-small.bin（中文日常推荐，487MB）或 ggml-base.bin（148MB，更快但稍差）
 *   3. 设置环境变量：
 *        WHISPER_CLI_PATH   = C:\path\to\whisper-cli.exe
 *        WHISPER_MODEL_PATH = C:\path\to\ggml-small.bin
 *   （或运行 pnpm --filter @app/web setup:offline 自动下载到 apps/web/tools/whisper/）
 *
 * whisper.cpp 输入要求：PCM 16-bit, 16kHz, mono WAV
 * —— ffmpeg.ts 的 extractAudioTrack() 已经满足该格式，所以这里直接用
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { LanguageCode } from '@/lib/types';
import type { AsrProvider, AsrResult, AsrSegment } from './types';
import { parseSrt } from '@/lib/subtitles';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDefaultWhisperPaths(): { cli: string; model: string } {
  // 跟 storage 一样反推：
  //   __dirname = apps/web/src/server/asr
  //   向上 4 层 = apps/web → tools/whisper 就在它下面
  const webRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const toolsDir = path.join(webRoot, 'tools', 'whisper');
  const isWin = process.platform === 'win32';
  return {
    cli: path.join(toolsDir, isWin ? 'whisper-cli.exe' : 'whisper-cli'),
    model: path.join(toolsDir, 'models', 'ggml-small.bin'),
  };
}

const LANG_TO_WHISPER: Record<LanguageCode, string> = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
};

function normalizeLang(lang: string | undefined): LanguageCode {
  if (!lang) return 'zh';
  const l = lang.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('ja') || l.startsWith('jp')) return 'ja';
  if (l.startsWith('en')) return 'en';
  return 'zh';
}

/**
 * 从 whisper.cpp stderr/stdout 中提取 "[DetectedLanguage]: xx"
 * 不同版本 whisper.cpp 输出格式有差异，这里兼容几种常见模式
 */
function parseDetectedLanguage(output: string): string | undefined {
  const patterns = [
    /detected\s+language[:\s]+['"]?([a-z]{2,3})['"]?/i,
    /DetectedLanguage\]\s*[:\s]+['"]?([a-z]{2,3})/i,
    /whisper_full_parallel\].*\(language\s*=\s*([a-z]{2,3})\)/i,
    /auto-detect.*language\s*=\s*([a-z]{2,3})/i,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return undefined;
}

export class WhisperCppProvider implements AsrProvider {
  readonly name = 'whisper-cpp';
  private readonly cliPath: string;
  private readonly modelPath: string;
  private readonly threads: number;

  constructor(opts?: { cliPath?: string; modelPath?: string; threads?: number }) {
    const defaults = getDefaultWhisperPaths();
    this.cliPath = opts?.cliPath ?? process.env.WHISPER_CLI_PATH ?? defaults.cli;
    this.modelPath = opts?.modelPath ?? process.env.WHISPER_MODEL_PATH ?? defaults.model;
    this.threads = Math.max(
      1,
      opts?.threads ??
        (parseInt(process.env.WHISPER_THREADS ?? '', 10) ||
          Math.min(8, Math.max(4, Math.floor(os.cpus().length / 2) || 4))),
    );

    if (!fs.existsSync(this.cliPath)) {
      throw new Error(
        `[whisper-cpp] 找不到 whisper-cli 可执行文件：${this.cliPath}\n` +
          `请先运行 "pnpm --filter @app/web setup:offline" 自动下载，或在 .env.local 中设置 WHISPER_CLI_PATH。`,
      );
    }
    if (!fs.existsSync(this.modelPath)) {
      throw new Error(
        `[whisper-cpp] 找不到模型文件：${this.modelPath}\n` +
          `请先运行 "pnpm --filter @app/web setup:offline" 自动下载，或在 .env.local 中设置 WHISPER_MODEL_PATH。`,
      );
    }
  }

  async transcribe(
    audioPath: string,
    opts: { langHint?: LanguageCode; onProgress?: (pct: number, stage: string) => void },
  ): Promise<AsrResult> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`[whisper-cpp] 音频文件不存在：${audioPath}`);
    }
    opts.onProgress?.(3, '准备 whisper.cpp 参数...');

    const lang = opts.langHint ? LANG_TO_WHISPER[opts.langHint] : 'auto';

    // SRT 输出到与音频同目录的 .tmp.srt，避免重名冲突
    const audioDir = path.dirname(audioPath);
    const base = path.basename(audioPath, path.extname(audioPath));
    const srtOutPrefix = path.join(audioDir, `${base}.whisper-out`);
    const expectedSrt = `${srtOutPrefix}.srt`;

    // 先清理可能的旧输出
    try {
      fs.rmSync(expectedSrt, { force: true });
    } catch {
      /* noop */
    }

    const args = [
      '-m',
      this.modelPath,
      '-f',
      audioPath,
      '-l',
      lang,
      '-p',
      String(this.threads),
      '-osrt', // 输出 SRT 格式字幕
      '-of',
      srtOutPrefix, // 输出文件前缀（会自动追加 .srt）
      '-ng', // 不输出字形进度字符，减少 stderr 噪声
      '-v', // 错误时 verbose
    ];

    opts.onProgress?.(8, `启动 whisper.cpp（模型 ${path.basename(this.modelPath)}，线程 ${this.threads}）...`);

    let startTs = Date.now();
    const stderrBuf: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.cliPath, args, { windowsHide: true });

      // 伪进度：按时间平滑推送，whisper.cpp 没有实时进度 API
      let fakePct = 10;
      const stage = '本地语音识别中（whisper.cpp CPU）';
      const timer = setInterval(() => {
        if (fakePct < 92) {
          fakePct = Math.min(92, fakePct + 2);
          opts.onProgress?.(fakePct, stage);
        }
      }, 3000);

      child.stderr?.on('data', (d) => {
        stderrBuf.push(d);
      });

      child.on('error', (err) => {
        clearInterval(timer);
        reject(new Error(`[whisper-cpp] 启动失败: ${err.message}`));
      });
      child.on('exit', (code, signal) => {
        clearInterval(timer);
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        if (code === 0) {
          opts.onProgress?.(93, `whisper.cpp 完成（耗时 ${elapsed}s），解析 SRT...`);
          resolve();
        } else {
          const stderrText = Buffer.concat(stderrBuf).toString('utf8').slice(-800);
          reject(
            new Error(
              `[whisper-cpp] 退出码 ${code}（signal ${signal ?? 'none'}）。\n` +
                `命令：${path.basename(this.cliPath)} ${args.slice(0, 6).join(' ')} ...\n` +
                `stderr 末尾：\n${stderrText}`,
            ),
          );
        }
      });
    });

    if (!fs.existsSync(expectedSrt)) {
      // 某些版本 whisper.cpp 可能输出到 <audioPath>.srt（当 -of 不生效时），兜底
      const fallback = `${audioPath}.srt`;
      if (fs.existsSync(fallback)) {
        fs.copyFileSync(fallback, expectedSrt);
      } else {
        throw new Error(
          `[whisper-cpp] 未找到生成的 SRT 文件，期望：${expectedSrt}\n` +
            `请检查 whisper-cli.exe 版本（推荐 1.7.3+）或手动验证 ${path.basename(audioPath)}.wav 是否 16kHz 单声道 PCM。`,
        );
      }
    }

    const srtText = await fs.promises.readFile(expectedSrt, 'utf8');
    const cues = parseSrt(srtText);

    // 清理临时 SRT
    try {
      fs.rmSync(expectedSrt, { force: true });
    } catch {
      /* noop */
    }

    opts.onProgress?.(97, `SRT 解析成功（${cues.length} 条），后处理...`);

    // SubtitleCue → AsrSegment（秒单位）
    const segments: AsrSegment[] = cues
      .filter((c) => c.startMs < c.endMs && c.text.trim().length > 0)
      .map((c) => ({
        start: c.startMs / 1000,
        end: c.endMs / 1000,
        text: c.text.trim(),
      }));

    const durationSec = segments.length > 0 ? segments[segments.length - 1]!.end : 0;

    // 识别语言：优先 langHint，其次从 whisper.cpp stderr 正则匹配，兜底 'zh'
    const stderrText = Buffer.concat(stderrBuf).toString('utf8');
    const detectedFromLog = parseDetectedLanguage(stderrText);
    const language: LanguageCode = opts.langHint ?? normalizeLang(detectedFromLog);

    return { language, durationSec, segments };
  }
}
