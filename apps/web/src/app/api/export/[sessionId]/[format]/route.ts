// apps/web/src/app/api/export/[sessionId]/[format]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { toSrt, toVtt } from '@/lib/subtitles';
import { decodeCues } from '@/server/db/cues-codec';
import type { LanguageCode } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Format = 'srt' | 'vtt';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; format: string }> },
) {
  const { sessionId, format: rawFormat } = await params;
  const format = rawFormat.toLowerCase() as Format;
  if (format !== 'srt' && format !== 'vtt') {
    return NextResponse.json({ error: `不支持的导出格式：${format}（仅 srt / vtt）` }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const lang = (searchParams.get('lang') as LanguageCode | null) ?? null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { subtitles: true },
  });
  if (!session) return NextResponse.json({ error: 'Session 不存在' }, { status: 404 });

  if (session.subtitles.length === 0) {
    return NextResponse.json({ error: '该视频尚无字幕' }, { status: 404 });
  }

  // 选择语言：优先 lang 参数 → 否则源语言字幕 → 第一个可用
  let subtitle = lang ? session.subtitles.find((s) => s.language === lang) : undefined;
  if (!subtitle) {
    subtitle = session.subtitles.find((s) => s.isSource) ?? session.subtitles[0];
  }
  if (!subtitle) return NextResponse.json({ error: '找不到匹配的字幕' }, { status: 404 });

  const cues = decodeCues(subtitle.cues);
  const content = format === 'srt' ? toSrt(cues) : toVtt(cues);

  const filename = `${session.id}.${subtitle.language}.${format}`;
  const mime = format === 'srt' ? 'application/x-subrip' : 'text/vtt';

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': `${mime}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(new Blob([content]).size),
    },
  });
}
