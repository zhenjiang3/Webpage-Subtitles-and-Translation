import type { Metadata, Viewport } from 'next';
import { ReactQueryProvider } from '@/components/provider/ReactQueryProvider';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: '网页字幕助手 — 视频一键生成字幕并翻译',
  description: '上传视频自动生成中/英/日字幕，在线编辑，支持中英日互译，SRT/VTT 一键导出。',
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </body>
    </html>
  );
}
