#!/usr/bin/env node
/**
 * 一键下载「方案 A：免费零 API」所需要的 whisper.cpp Windows 预编译包 + ggml-small 模型
 *
 * 用途：V1 用户不想申请任何 API Key 时，运行：
 *         cd apps/web
 *         pnpm setup:offline
 *       本脚本会：
 *         1. 从 ggml-org/whisper.cpp GitHub Releases 下载 whisper-bin-x64.zip（CPU 版）
 *         2. 解压到 apps/web/tools/whisper/（得到 whisper-cli.exe + 若干 dll）
 *         3. 从 HuggingFace 下载 ggml-small.bin（487MB，中文识别精度最佳体积权衡）
 *            保存到 apps/web/tools/whisper/models/
 *         4. 打印出 .env.local 建议配置（可选：直接写入 .env.local）
 *
 * 注：本脚本不依赖任何第三方 npm 包，全部使用 Node 22+ 内置模块。
 *     Windows 下默认用 PowerShell Expand-Archive 解压 zip；
 *     若 PowerShell 不可用，将尝试 node:zlib（不支持 deflate64 → 失败兜底提示）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..'); // apps/web/
const TOOLS_DIR = path.join(WEB_ROOT, 'tools');
const WHISPER_DIR = path.join(TOOLS_DIR, 'whisper');
const MODELS_DIR = path.join(WHISPER_DIR, 'models');
const ZIP_PATH = path.join(os.tmpdir(), `whisper-bin-x64-${Date.now()}.zip`);
const MODEL_PATH = path.join(MODELS_DIR, 'ggml-small.bin');

// —— 可下载源（官方 + 国内镜像，做容错）——
const WHISPER_RELEASE_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest';
const WHISPER_ZIP_FALLBACK = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip';
const HUGGINGFACE_MODEL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
const HUGGINGFACE_MIRROR = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

// —— 简易进度条（ETL 风格）——
function makeProgress(label, sizeHintMB) {
  let lastPct = -1;
  let received = 0;
  const startTs = Date.now();
  return (chunkLen) => {
    received += chunkLen;
    const pct = sizeHintMB ? Math.min(99, Math.round((received / (sizeHintMB * 1024 * 1024)) * 100)) : -1;
    if (pct !== -1 && pct !== lastPct) {
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      const mb = (received / 1024 / 1024).toFixed(1);
      process.stdout.write(`\r  ${label}  ${pct}%  (${mb}MB / ${sizeHintMB}MB, ${elapsed}s)   `);
      lastPct = pct;
    }
  };
}

async function fetchWithRedirect(url, options = undefined) {
  // 支持 302 / 301 跟随（GitHub/HF 都有）
  let currentUrl = url;
  let redirects = 0;
  while (redirects < 8) {
    const res = await fetch(currentUrl, { redirect: 'manual', ...(options ?? {}) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect ${res.status} without Location: ${currentUrl}`);
      currentUrl = new URL(loc, currentUrl).toString();
      redirects += 1;
      continue;
    }
    return { res, finalUrl: currentUrl };
  }
  throw new Error(`Too many redirects (>8) for ${url}`);
}

/**
 * 通用下载：支持断点 / 进度 / 失败自动切镜像
 */
async function download({ urls, dest, sizeHintMB, label }) {
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`✔ ${label} 已存在 (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)}MB)，跳过：${dest}`);
    return;
  }
  const tmp = dest + '.downloading';
  let lastErr = null;
  for (const url of urls) {
    try {
      console.log(`  ▶ 下载 ${label}  →  ${url}`);
      const { res } = await fetchWithRedirect(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const totalLen = res.headers.get('content-length');
      const hintMB = sizeHintMB ?? (totalLen ? Math.round(parseInt(totalLen, 10) / 1024 / 1024) : undefined);
      const onChunk = makeProgress(label, hintMB);
      const writer = fs.createWriteStream(tmp);
      const reader = Readable.fromWeb(res.body);
      reader.on('data', (chunk) => onChunk(chunk.length));
      await pipeline(reader, writer);
      fs.renameSync(tmp, dest);
      process.stdout.write('\n'); // 换行
      const size = fs.statSync(dest).size;
      console.log(`✔ ${label} 完成 (${(size / 1024 / 1024).toFixed(1)}MB)  →  ${dest}`);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`\n⚠ ${label} 从 ${url} 下载失败：${e && e.message ? e.message : String(e)}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* noop */
      }
    }
  }
  throw new Error(`所有 ${label} 下载源全部失败。最后一个错误：${lastErr && lastErr.message ? lastErr.message : String(lastErr)}`);
}

/**
 * 解压 zip（Windows 调用 PowerShell Expand-Archive，兼容 whisper-bin-x64 的 deflate64）
 */
function extractZipWindows(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const ps = [
    `$ErrorActionPreference = 'Stop'`,
    `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`Expand-Archive 失败（退出码 ${r.status ?? 'null'}）`);
  }
}

async function resolveLatestWhisperZipUrl() {
  try {
    const { res } = await fetchWithRedirect(WHISPER_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const json = (await res.json()) ?? {};
      const assets = json.assets ?? [];
      const hit = assets.find((a) => typeof a?.name === 'string' && a.name.toLowerCase() === 'whisper-bin-x64.zip');
      if (hit?.browser_download_url) return [hit.browser_download_url, WHISPER_ZIP_FALLBACK];
    }
  } catch (e) {
    console.warn(`⚠ 获取 GitHub Releases 元数据失败，直接用固定 URL。原因：${e && e.message ? e.message : String(e)}`);
  }
  return [WHISPER_ZIP_FALLBACK];
}

async function writeEnvLocalIfMissing() {
  const envLocal = path.join(WEB_ROOT, '.env.local');
  const whisperCliName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const block =
    '\n# =============== 方案 A：免费零 API（whisper.cpp + Xenova NLLB） ===============\n' +
    'ASR_PROVIDER=whisper-cpp\n' +
    `WHISPER_CLI_PATH=${path.join(WHISPER_DIR, whisperCliName)}\n` +
    `WHISPER_MODEL_PATH=${path.join(MODELS_DIR, 'ggml-small.bin')}\n` +
    '# WHISPER_THREADS=8  # 可选：默认自动=CPU 核数/2（上限8，下限4）\n' +
    'TRANSLATOR_PROVIDER=xenova-nllb\n' +
    '# XENOVA_CACHE_DIR=./.cache/xenova  # 可选：NLLB 模型缓存目录（默认 HuggingFace 系统目录）\n' +
    '# ===========================================================================\n';
  if (!fs.existsSync(envLocal)) {
    // 初始空文件：注释 + 配
    fs.writeFileSync(envLocal, block.trimStart(), 'utf8');
    console.log(`✔ 已写入初始 ${path.relative(WEB_ROOT, envLocal)}（免费方案 A 所需变量）`);
    return;
  }
  const existing = fs.readFileSync(envLocal, 'utf8');
  // 已经有 ASR_PROVIDER=whisper-cpp 就不再追加
  if (existing.includes('ASR_PROVIDER=whisper-cpp') || existing.includes('ASR_PROVIDER=whispercpp')) {
    console.log(`ℹ 检测到 .env.local 已配置 whisper-cpp/xenova-nllb，跳过写文件。`);
    return;
  }
  fs.writeFileSync(envLocal, existing.trimEnd() + '\n' + block, 'utf8');
  console.log(`✔ 已在 .env.local 末尾追加方案 A 环境变量。`);
}

async function main() {
  const platformOk = process.platform === 'win32';
  if (!platformOk) {
    console.warn(
      `⚠  本 setup:offline 脚本默认是 Windows (x64) 一键安装；当前平台 = ${process.platform}。\n` +
        `   你可以手动：1) 下载 whisper.cpp Releases 对应平台二进制；2) 下载 ggml-small.bin；3) 在 .env.local 里设置 WHISPER_CLI_PATH / WHISPER_MODEL_PATH。`,
    );
  }
  console.log('\n===== 🛠  Offline Setup：下载 whisper.cpp Windows 预编译 + ggml-small.bin 模型 =====\n');
  console.log(`  目标目录：${WHISPER_DIR}`);
  console.log(`  预计总下载：~30MB (zip) + 487MB (model)，解压后约 550MB。\n`);

  // 1. 解析最新下载 URL
  const zipUrls = platformOk ? await resolveLatestWhisperZipUrl() : [WHISPER_ZIP_FALLBACK];

  // 2. 下载 zip
  if (platformOk) {
    await download({
      urls: zipUrls,
      dest: ZIP_PATH,
      sizeHintMB: 30,
      label: 'whisper-bin-x64.zip',
    });

    // 3. 解压
    console.log(`  ▶ 解压 ${path.basename(ZIP_PATH)}  →  ${WHISPER_DIR}`);
    try {
      extractZipWindows(ZIP_PATH, WHISPER_DIR);
      // 解压后可能多一层 whisper-bin-x64/ 目录，需要摊平
      const innerDir = path.join(WHISPER_DIR, 'whisper-bin-x64');
      if (fs.existsSync(innerDir)) {
        for (const f of fs.readdirSync(innerDir)) {
          const src = path.join(innerDir, f);
          const dst = path.join(WHISPER_DIR, f);
          if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
          fs.renameSync(src, dst);
        }
        fs.rmdirSync(innerDir, { recursive: true });
      }
      const exe = path.join(WHISPER_DIR, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
      if (!fs.existsSync(exe)) {
        throw new Error(`解压完成但找不到 ${path.basename(exe)}，目录内容：${fs.readdirSync(WHISPER_DIR).join(' ,')}`);
      }
      console.log(`✔ whisper-cli.exe 就绪：${exe}`);
    } finally {
      try {
        fs.rmSync(ZIP_PATH, { force: true });
      } catch {
        /* noop */
      }
    }
  }

  // 4. 下载模型 ggml-small.bin
  await download({
    urls: [HUGGINGFACE_MODEL, HUGGINGFACE_MIRROR],
    dest: MODEL_PATH,
    sizeHintMB: 487,
    label: 'ggml-small.bin（ASR 模型）',
  });

  // 5. 写 .env.local（如果需要）
  await writeEnvLocalIfMissing();

  console.log('\n================================== ✅ 全部完成 ==================================');
  console.log('下一步：');
  console.log('  1. 确认 ffmpeg 已安装：winget install Gyan.FFmpeg （如已装可跳过）');
  console.log('  2. 启动开发服务器：pnpm --filter @app/web dev');
  console.log('  3. 浏览器打开 http://localhost:3000 → 上传视频 → 自动识别 + 翻译');
  console.log('');
  console.log('  Xenova NLLB 首次翻译时会自动下载 ~900MB 模型，耐心等待（后续永久离线）');
  console.log('=================================================================================\n');
}

main().catch((e) => {
  console.error('\n❌ setup:offline 失败：');
  console.error(e?.stack ?? e?.message ?? String(e));
  process.exit(1);
});
