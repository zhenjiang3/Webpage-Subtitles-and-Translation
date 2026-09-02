// apps/web/src/app/page.tsx — 首页：上传入口
import Link from 'next/link';
import { VideoUploader } from '@/components/upload/VideoUploader';
import { Sparkles, Languages, Edit3, Download } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="inline-grid place-items-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="w-4 h-4" />
            </span>
            <span>网页字幕助手</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              V1 MVP
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="#features">功能</Link>
            <Link href="#workflow">流程</Link>
          </nav>
        </div>
      </header>

      {/* Hero + Uploader */}
      <main className="flex-1 container py-10 md:py-16">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            上传视频，<span className="text-primary">一键生成字幕</span> 并翻译
          </h1>
          <p className="mt-5 text-base md:text-lg text-muted-foreground">
            基于 Whisper 的语音识别 + DeepL 翻译。支持 <b>中文 · English · 日本語</b> 三语互译，
            SRT / VTT 直接导出。
          </p>
        </div>

        <VideoUploader />

        {/* 特性卡片 */}
        <section id="features" className="mt-20 grid gap-5 md:grid-cols-3">
          <FeatureCard
            icon={<Sparkles className="w-5 h-5" />}
            title="AI 自动识别"
            desc="基于 Whisper 模型，自动从视频语音中提取带时间轴的字幕，支持中/英/日三语。"
          />
          <FeatureCard
            icon={<Languages className="w-5 h-5" />}
            title="高质量翻译"
            desc="默认使用 DeepL 专业翻译 API，保留换行和字幕长度控制，一键切换多语种。"
          />
          <FeatureCard
            icon={<Edit3 className="w-5 h-5" />}
            title="在线编辑"
            desc="点击字幕跳转视频，逐行修改文字和时间，自动保存到本地数据库。"
          />
          <FeatureCard
            icon={<Download className="w-5 h-5" />}
            title="一键导出"
            desc="SRT / WebVTT 两种标准格式，兼容 YouTube、Bilibili、Pr、剪映等平台。"
          />
        </section>

        {/* 流程 */}
        <section id="workflow" className="mt-20">
          <h2 className="text-2xl font-bold text-center mb-10">5 步完成字幕制作</h2>
          <ol className="flex flex-col md:flex-row gap-4 md:gap-2 items-stretch text-sm">
            {[
              ['①', '上传视频', 'MP4/MOV/WebM/MKV 均可'],
              ['②', 'AI 识别语音', '提取带时间戳的原文'],
              ['③', '在线编辑核对', '点击字幕跳转播放'],
              ['④', '一键翻译', '中 ↔ 英 ↔ 日 任意组合'],
              ['⑤', '导出字幕', 'SRT 或 WebVTT 下载'],
            ].map(([num, title, desc]) => (
              <li
                key={num}
                className="flex-1 rounded-xl border bg-card p-5 flex gap-3 items-start"
              >
                <span className="grid place-items-center w-8 h-8 rounded-md bg-primary/10 text-primary font-bold">
                  {num}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t mt-16">
        <div className="container h-14 flex items-center justify-between text-xs text-muted-foreground">
          <span>© 2026 网页字幕助手 · Powered by Whisper + DeepL</span>
          <span>请遵守版权法规，只上传有合法授权的视频</span>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-6 transition hover:shadow-md hover:border-primary/30">
      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
        {icon}
      </div>
      <h3 className="mt-4 font-semibold text-lg">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
