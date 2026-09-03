# 网页字幕助手 · Webpage Subtitles & Translation

> 把视频丢进浏览器 → 一键本地离线生成字幕 → 一键中英日三语种互译 → 导出 SRT。
> **V1 主打「免费零 API」**：无需任何云端 Key，whisper.cpp（本地 ASR）+ Xenova NLLB-200（本地翻译），全程跑在你自己的 CPU 上。

---

<p align="center">
  <a href="#-v1-核心功能">功能</a> ·
  <a href="#%EF%B8%8F-技术架构">架构</a> ·
  <a href="#-项目结构">目录结构</a> ·
  <a href="#-快速开始方案-a--免费零-api">快速开始（零 API ⭐）</a> ·
  <a href="#-备用云端方案-openai--deepl--deepseek">备用云端方案</a> ·
  <a href="#%EF%B8%8F-v1-限制--v2-roadmap">V1 限制 / Roadmap</a> ·
  <a href="#-故障排查">故障排查</a> ·
  <a href="#-开发约定--提交规范">开发约定</a>
</p>

---

## ✨ V1 核心功能

| 模块 | 说明 |
|---|---|
| 🎬 **视频上传** | 浏览器拖拽 / 选择文件上传；单文件 ≤ 500MB、时长 ≤ 30 分钟 |
| 🔊 **本地 ASR（语音转字幕）** | **whisper.cpp**（C++ 预编译）+ ggml-small.bin（487MB），CPU 即可跑，无 API / 无 Python |
| ✏️ **字幕编辑器** | 时间轴精确编辑、增删条目、与播放器联动高亮当前句 |
| 🌐 **本地翻译（中英日）** | **Xenova NLLB-200**（ONNX int8，~900MB 单模型覆盖 200+ 语言）；V1 开放：中 ↔ 英、中 ↔ 日、英 ↔ 日 |
| 💾 **字幕导出** | 导出为标准 `.srt`，VLC / 剪映 / Premiere 可直接加载 |
| 📈 **任务进度** | 上传 / ASR / 翻译 全部走 Job 队列，前端轮询显示百分比，支持刷新不丢进度 |

> V1 严格聚焦：**仅 3 种目标语言（简体中文 / 英文 / 日文）**。其他语种、VTT、批量文件、团队协作等放入 V2 Roadmap。

---

## 🏗️ 技术架构

```
                 ┌────────────────────────────────────────────┐
                 │        用户浏览器（Next.js SSR + CSR）       │
                 │  VideoUploader / VideoPlayer / SubtitleList │
                 │  TranslatePanel / ExportMenu               │
                 └───────────────────────┬────────────────────┘
                                         │ React Query (fetch)
                         ┌───────────────▼───────────────┐
                         │   Next.js 15 App Router (RSC) │
                         │  /api/upload  /api/translate  │
                         │  /api/sessions/:id/jobs       │
                         │  /api/subtitles/:sessionId    │
                         │  /api/export/:sessionId/srt   │
                         └───────────────┬───────────────┘
                                         │
                   ┌─────────────────────┼──────────────────────┐
                   │                     │                      │
          ┌────────▼────────┐  ┌────────▼─────────┐  ┌────────▼────────┐
          │   whisper.cpp   │  │   Xenova NLLB    │  │   Prisma +      │
          │  whisper-cli.exe│  │ transformers.js  │  │   SQLite        │
          │  ggml-small.bin │  │ onnxruntime-node │  │   data/app.db   │
          │  (ASR Provider) │  │  (NLLB Provider) │  │  Session /      │
          └────────┬────────┘  └────────┬─────────┘  │  Subtitle / Job │
                   │                    │             └─────────────────┘
          抽音频 ←──┘  ffmpeg.exe      │  HF Mirror (CN)
                                        │  (900MB 模型首次下载)
                                        ▼
                               hf-mirror.com / 本地缓存 .cache/xenova
```

**关键选型（V1 免费零 API 方案 A）：**

| 层 | 技术 | 版本 |
|---|---|---|
| 前端框架 | Next.js App Router (RSC) | 15.0.3 |
| UI / 样式 | React 19 + Tailwind CSS 4 + Plyr 视频播放器 | 19.0.0-rc / 4.0.0 / 3.7.8 |
| 数据 | Prisma + SQLite（本地文件，无需安装数据库）| Prisma 5.22 |
| 状态管理 | Zustand + @tanstack/react-query | Zustand 5 / React Query 5.61 |
| **语音识别（ASR）** | **whisper.cpp** C++ 预编译 + ggml-small.bin（CPU） | whisper.cpp 最新发行版 |
| **文本翻译** | **@xenova/transformers** + NLLB-200-600M-distilled int8 | xenova 2.17.2 |
| Monorepo / 构建 | pnpm 9 workspace + Turborepo 2 + TypeScript 5.6 | pnpm@9.15.9 (packageManager pinned) |
| **依赖隔离技巧** | `pnpm.overrides` + workspace stub 包 `@app/sharp-shim` 替代 sharp（解决 Xenova 依赖 sharp 原生二进制的 Windows 安装灾难）| — |

Provider 均以接口 + 工厂模式隔离（`server/asr/index.ts` / `server/translator/index.ts`），未来切换到 OpenAI Whisper API / DeepL / DeepSeek 零代码重构，仅改环境变量。

---

## 📁 项目结构

```
Webpage Subtitles and Translation/
├── apps/
│   └── web/                       # 主应用：Next.js 前端 + API Routes + Node 服务端
│       ├── prisma/schema.prisma   #   Session / Subtitle / Job 三表模型
│       ├── scripts/setup-offline.mjs # 一键：下载 whisper.cpp + ggml-small.bin + 写 .env.local
│       ├── src/
│       │   ├── app/               #   Next App Router：首页 + 编辑页 + 8 个 API Routes
│       │   ├── components/        #   VideoUploader VideoPlayer SubtitleList TranslatePanel ExportMenu
│       │   ├── server/
│       │   │   ├── asr/           #   ASR 提供者（whisper-cpp ✅ / openai-whisper 预留）
│       │   │   ├── translator/    #   翻译提供者（xenova-nllb ✅ / deepl / deepseek 预留）
│       │   │   ├── jobs/scheduler.ts  # 内存任务调度（ASR 并发 1、翻译并发 2）
│       │   │   ├── ffmpeg.ts      #   ffmpeg/ffprobe 抽音轨 + 封装
│       │   │   ├── db/cues-codec  #   SRT cue ↔ SQLite 字符串编码（Prisma SQLite 不支持 JSON natively）
│       │   │   └── storage/       #   上传/字幕/导出文件路径管理
│       │   └── lib/{types,time,utils,languages,subtitles}.ts  # 前后端共享纯逻辑
│       ├── tools/shim/sharp.cjs   #   (fallback) Sharp 兼容占位（主替换靠 packages/sharp-shim）
│       ├── .env.example           #   本 app 的环境变量模板（带中文注释）
│       └── package.json           #   scripts: dev / dev:ca / build / lint / typecheck / setup:offline
├── packages/
│   └── sharp-shim/                # Workspace 包：Sharp API 兼容占位包（0 原生依赖）
│       ├── index.cjs              #   Sharp 构造函数 + .format/.versions + 链式 Proxy
│       ├── index.d.cts            #   类型声明
│       └── package.json           #   被根 package.json pnpm.overrides 引用：sharp → workspace:@app/sharp-shim@*
│
├── AGENTS.md                      # ⭐ 核心开发约定：commit 格式 / 测试规范 / 交付前检查清单
├── DESIGN.md  DESIGN-V1.md        # 完整设计文档（14 章 + V1 收缩版）
├── .env.example                   # 根环境变量模板（ASR + 翻译 + FFmpeg + Xenova 网络配置）
├── pnpm-workspace.yaml            # workspace 包含：apps/*、packages/*
├── package.json                   # (workspace root) turbo scripts + pnpm.overrides + packageManager
├── pnpm-lock.yaml                 # pnpm 锁文件（严格可复现）
├── turbo.json  tsconfig.base.json # Turborepo 流水线 + 根 TS 基础配置
├── .prettierrc  .gitignore        # 代码格式化 + 忽略大体积本地产物（whisper 二进制 /.cache/xenova）
└── README.md                      # (本文档)
```

---

## 🚀 快速开始（方案 A ⭐ 免费零 API）

无需任何信用卡、无需注册任何 Key、所有计算在本机 CPU 上完成。

### 🧰 前置条件

| 工具 | 最低版本 | PowerShell 检查命令 |
|---|---|---|
| Windows 10/11 | — | `[Environment]::OSVersion.Version` |
| Node.js | ≥ 20（推荐 24）| `node -v` |
| pnpm | ≥ 9（推荐 9.15.9）| `pnpm -v` （不存在就：`& D:\npm.cmd i -g pnpm@9.15.9`）|
| FFmpeg | 任意稳定版（推荐 7/9）| `ffmpeg -version`（不存在见下文第 2 步 winget 装）|

PowerShell 执行命令请全程使用 `& D:\pnpm.CMD …` / `& D:\npm.cmd …`（不要裸跑 pnpm/npm，本机 ExecutionPolicy 会阻塞 `.ps1` 包装脚本）。

---

### 第 1 步：克隆 + 安装依赖

```powershell
git clone https://github.com/zhenjiang3/Webpage-Subtitles-and-Translation.git
cd "Webpage-Subtitles-and-Translation"

# 安装（--ignore-scripts 跳过 sharp 原生构建脚本；--no-frozen-lockfile 允许首次写 lock）
& D:\pnpm.CMD install --ignore-scripts --no-frozen-lockfile
```

### 第 2 步：安装 FFmpeg（如果 `ffmpeg -version` 报找不到）

```powershell
winget install Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
# 安装后关闭当前 PowerShell，重新开一个；然后执行 ffmpeg -version 验证
```

> 如果 winget 被公司策略禁用，到 https://www.gyan.dev/ffmpeg/builds/ 下载 `release-full_build` 解压，把 bin 目录里 `ffmpeg.exe / ffprobe.exe` 路径记下来，第 4 步写入 `.env.local` 的 `FFMPEG_BIN_PATH` / `FFPROBE_BIN_PATH`。

### 第 3 步：下载 whisper.cpp 二进制 + ggml-small.bin 模型（≈ 520MB）

```powershell
cd apps\web
& D:\pnpm.CMD setup:offline
```

> 脚本会：① 从 GitHub 下载 whisper-bin-x64.zip 解压到 `apps/web/tools/whisper/` ② 从 HuggingFace（或镜像）下载 ggml-small.bin 到 `tools/whisper/models/` ③ 自动写入 `apps/web/.env.local`（ASR_PROVIDER=whisper-cpp、WHISPER_CLI_PATH、WHISPER_MODEL_PATH、TRANSLATOR_PROVIDER=xenova-nllb）。下载失败请参阅 [下方故障排查](#-故障排查)。

### 第 4 步：初始化 SQLite（创建表）

```powershell
# 在 apps/web 目录下执行
& D:\pnpm.CMD db:push
```

成功后项目根会出现 `data/app.db`（已在 `.gitignore` 中，**不会被提交**）。

### 第 5 步：启动开发服务器 【推荐 2 选 1】

#### 🥇 推荐：`--use-system-ca` 模式（解决企业 MITM / 自签证书）

```powershell
cd "Webpage-Subtitles-and-Translation\apps\web"
$env:NODE_OPTIONS="--use-system-ca"
& D:\pnpm.CMD dev
```

> 解释：Node.js 默认自带 Mozilla 根 CA 集，不读 Windows「受信任的根证书」。公司/校园透明代理替换 TLS 证书时会崩成 `TypeError: fetch failed`。加上 `--use-system-ca` 就能用 Windows 系统的真实证书库，一次加好终身受益。

#### 或者用现成脚本（效果相同）

```powershell
cd apps\web
& D:\pnpm.CMD run dev:ca
```

### 第 6 步：浏览器打开 → 开始翻译

```
浏览器访问： http://localhost:3000
```

操作流程：

1. **首页** 拖拽或选择一个视频文件（支持 mp4/mov/webm/mkv 等 ffmpeg 能识别的格式）
2. 自动上传 → 自动用 ffmpeg 抽音频 → **whisper.cpp 跑本地 ASR**（10 分钟视频约 2-5 分钟，取决于 CPU）
3. 跳转到 **编辑器页**：字幕可逐条改、视频点哪条字幕就高亮跳到对应时间
4. 右上 **「翻译」按钮** → 选目标语言（中文/英文/日文）→ 后台启动 Xenova NLLB 翻译任务
   - **第一次翻译**：控制台出现
     ```
     [xenova-nllb] 模型下载源：https://hf-mirror.com/  缓存：./.cache/xenova
     ```
     然后从 hf-mirror.com 国内镜像自动下载 900MB int8 模型（2-10 分钟，取决于带宽；下好后永久缓存到 `apps/web/.cache/xenova/`，**之后完全离线能用**）
   - 再点翻译：立刻开始推理，不需要重下模型
5. 右下「导出」→ **SRT**：下载 `.srt` 文件，丢进 VLC 或剪映都能直接对应视频显示。

---

## 🔌 备用云端方案（OpenAI / DeepL / DeepSeek）

如果你觉得本地模型太慢（或者机器 CPU 弱），可以切换到云端 Key（只需改环境变量，**零代码改动**）。

编辑 `apps/web/.env.local`（方案 A 的变量覆盖即可，注释掉原来的）：

```properties
# ====== （云端）ASR = OpenAI Whisper API ======
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# ASR_PROVIDER=openai-whisper

# ====== （云端）翻译 = DeepL Free ======
# DeepL Free 每月 50 万字符免费额度：https://www.deepl.com/pro-api
# DEEPL_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx
# TRANSLATOR_PROVIDER=deepl

# ====== （云端）翻译 = DeepSeek Chat LLM ======
# DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
# DEEPSEEK_BASE_URL=https://api.deepseek.com
# DEEPSEEK_MODEL=deepseek-v4-flash
# TRANSLATOR_PROVIDER=deepseek
```

> 注意：DeepSeek 目前**不提供 ASR（语音识别）API**，ASR 仍需 whisper.cpp（方案 A）或 OpenAI Whisper API。翻译功能 DeepSeek 兼容。

改完保存 → 重启 dev server（关了再开）→ 直接用，Provider 工厂根据 `ASR_PROVIDER` / `TRANSLATOR_PROVIDER` 自动切换。

---

## 🛣️ V1 限制 & V2 Roadmap

### 🔻 当前（V1）硬限制

- **翻译目标语言仅 3 种：简体中文（zh）/ 英文（en）/ 日文（ja）**。NLLB 模型本身支持 200+ 语言，只要放开前端下拉 + 映射就可用（V2）。
- 字幕导出仅 `.srt`；`.vtt`（网页 `<track>` 原生）未实现（V2）。
- 单用户设计：任务调度器是 Node 进程内存的 Promise 并发，重启 dev server 就丢运行中的 Job。V2 换 BullMQ + Redis 实现持久化。
- 没有账号/登录体系：所有 Session 存在本机 SQLite，单机自用没问题。
- 视频上传大小上限 500MB（`MAX_UPLOAD_BYTES`），可在 `.env.local` 修改。

### 🔺 V2 方向（按优先级排序）

1. `.vtt` / `.ass` 导出 + 导入 SRT/VTT（外部字幕送翻译）
2. 前端字幕「翻译进度条」优化（当前只显示 Job 队列百分比，不透漏第几条/总几条）
3. 批量视频：队列批量 ASR + 批量翻译
4. Xenova 模型大小选项：小模型 1.3B 蒸馏 → 更快 / 更大模型 3.3B → 更准（用户选）
5. 持久化任务队列 + 断点续译（BullMQ + Redis）
6. 用户认证（NextAuth + SQLite），多用户隔离会话

---

## 🔍 故障排查

按出现频率从高到低排序。所有报错都**尽量先按①②③…的顺序跟**，直接跳到下一步会绕路。

### ❌ 1. 端口 3000 被占用（`EADDRINUSE: address already in use :::3000`）

```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
# 然后重新启动 dev server
```

### ❌ 2. 启动首页、上传正常，但点「翻译」报错 `sharp-win32-x64.node / Cannot find module '../build/Release/sharp-xxx.node'`

本仓库**已经根治**（pnpm overrides → 把 sharp 全树替换成 workspace stub 包）。如果你出现这个错误，几乎一定是：

- ① 忘了跑 `& D:\pnpm.CMD install --ignore-scripts --no-frozen-lockfile`，node_modules 里的 symlink 还是旧的；重跑一次第 1 步的 install。
- ② 启动的是老的 Node 进程。`Get-Process -Name node | Stop-Process -Force` 杀掉，用**新的** PowerShell 窗口启动。

### ❌ 3. 点「翻译」报错 `TypeError: fetch failed`

Xenova 下载模型时网络失败（公司 MITM / HuggingFace 不通 / 代理没配）。V1 代码已经在 throw 时把 5 条修复方案打印成一大屏中文横幅 ⬇，**直接按横幅的 ①→②→③ 试**就行：

```
═══ [xenova-nllb] 模型下载失败（网络 / 证书类错误）═══
  ① NODE_OPTIONS="--use-system-ca" 重启 dev（最推荐 / 最安全）
  ② HF_MIRROR_INSECURE=1 临时禁用 TLS（仅本机开发）
  ③ 换镜像 XENO_REMOTE_HOST=https://hf-mirror.chuying.org/
  ④ 配 HTTPS_PROXY=http://127.0.0.1:7890
  ⑤ 模型已经手动下好？XENO_FORCE_LOCAL=1 完全不走网络
═══════════════════════════════════════════════════════
```

> `.env.local` 里所有 5 个开关都已经写了中文注释，取消注释即可。也可以直接看 [apps/web/.env.example](apps/web/.env.example) 模板。

### ❌ 4. 视频上传成功后，ASR 失败「找不到 ffmpeg」或「ffprobe」

```powershell
# 查当前机器 ffmpeg 实际位置：
Get-Command ffmpeg  | Select-Object -ExpandProperty Source
Get-Command ffprobe | Select-Object -ExpandProperty Source
```

把两条输出的**完整绝对路径**（包含 `ffmpeg.exe` / `ffprobe.exe`）写入 `apps/web/.env.local`：
```properties
FFMPEG_BIN_PATH=C:\xxx\...\ffmpeg.exe
FFPROBE_BIN_PATH=C:\xxx\...\ffprobe.exe
```
保存后重启 dev server。

### ❌ 5. setup:offline 报下载失败（GitHub / HuggingFace 连不上 / 证书错误）

把 setup-offline 用和第 5 步启动 dev server 一样的方式加上 `--use-system-ca`（setup:offline 脚本已经默认用 node --use-system-ca 了）；如果仍然不行：

- 手动下载 whisper.cpp Windows 发行版：https://github.com/ggml-org/whisper.cpp/releases/latest → 找到 `whisper-bin-x64.zip` 下载，解压到 `apps/web/tools/whisper/`（保证里面有 `whisper-cli.exe`）
- 手动下载 ggml-small.bin（487MB）：`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin`（或 hf-mirror 镜像源），放到 `apps/web/tools/whisper/models/ggml-small.bin`
- 然后**再跑一次** `& D:\pnpm.CMD setup:offline`（它会检测文件已存在，跳过下载、只补 .env.local）

### ❌ 6. 翻译第一次成功、第二次突然巨慢、内存爆

NLLB 推理按 15 条分 micro-batch，正常不会爆。但你如果在开发阶段反复点热重启 Next，可能留了多个 ONNX Runtime Session。**杀一次 node 进程重开 dev server** 就能清理。生产环境（next build && next start）下没有这个问题。

---

## 👩‍💻 开发约定 & 提交规范

所有贡献请严格遵循 [AGENTS.md](AGENTS.md)。摘要如下：

### 📝 Commit Message 格式

必须 `<type>(<scope>): <subject>`，小写英文，冒号后空一格。示例：

```
feat(translate): add DeepSeek Chat translation provider
fix(nllb): replace sharp with workspace stub via pnpm overrides
docs(project): add project overview README with architecture and setup guide
chore(gitignore): exclude whisper.cpp local binaries
refactor(scheduler): replace memory queue with BullMQ
test(asr): add whisper-cpp SRT parse unit tests
```

常用 type：`feat / fix / docs / style / refactor / test / chore`

### ✅ 每次改完必须过的 5 条 checklist

```
[ ] 所有代码改动已 commit，message 符合 format，一条 commit 只含一个独立逻辑变更
[ ] pnpm --filter @app/web typecheck    # （TS 全绿，无 0 exit 以外）
[ ] pnpm --filter @app/web lint         # （"✔ No ESLint warnings or errors"）
[ ] 改动涉及的功能已在浏览器本地手动走通一遍（上传 → ASR → 翻译 → 导出）
[ ] 无明显的副作用：未改别的模块 / 没引入新的 npm audit critical 漏洞
```

### 🧪 测试策略

- 核心功能：`whispercpp.provider.ts` 的 SRT 解析、`cues-codec.ts`、`translateSlice()` —— 建议跑一个 Jest（未来接入 Vitest）单测覆盖
- E2E：用 `next dev` + 浏览器走完整链路的 4 个按钮（上一节 checklist 第 4 条）作为人工 E2E
- 禁止 skip 测试；禁止"先跳过以后补"

---

## 📄 License

MIT © 本项目贡献者
