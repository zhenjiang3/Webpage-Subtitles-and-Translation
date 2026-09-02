// apps/web/src/app/api/subtitles/[sessionId]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { CueArraySchema, decodeCues, encodeCues } from '@/server/db/cues-codec';
import type { LanguageCode } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LANG_WHITELIST: ReadonlySet<string> = new Set(['zh', 'en', 'ja']);

// ============ GET：获取某 session 的字幕（单语或全部） ============
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const { searchParams } = new URL(req.url);
  const langFilter = searchParams.get('lang');

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: 'Session 不存在' }, { status: 404 });

  const where = langFilter ? { sessionId, language: langFilter } : { sessionId };
  const subtitles = await prisma.subtitle.findMany({
    where,
    orderBy: [{ isSource: 'desc' }, { language: 'asc' }],
  });

  return NextResponse.json({
    session: {
      id: session.id,
      videoName: session.videoName,
      durationSec: session.durationSec,
      sourceLang: session.sourceLang,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
    },
    subtitles: subtitles.map((s) => ({
      id: s.id,
      language: s.language,
      isSource: s.isSource,
      version: s.version,
      cues: decodeCues(s.cues),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

// ============ PUT：全量保存（编辑器自动保存 / 手动保存） ============
const SaveBodySchema = z.object({
  language: z.string().refine((l) => LANG_WHITELIST.has(l), '仅支持 zh / en / ja'),
  cues: CueArraySchema,
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: 'Session 不存在' }, { status: 404 });

  let body: z.infer<typeof SaveBodySchema>;
  try {
    body = SaveBodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: '请求参数错误', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const lang = body.language as LanguageCode;

  // 基本合法性：startMs < endMs
  for (const c of body.cues) {
    if (c.endMs <= c.startMs) {
      return NextResponse.json(
        { error: `第 ${c.index} 条字幕结束时间必须大于开始时间` },
        { status: 400 },
      );
    }
  }

  const cuesJson = encodeCues(body.cues);

  const updated = await prisma.subtitle.upsert({
    where: { sessionId_language: { sessionId, language: lang } },
    create: {
      sessionId,
      language: lang,
      isSource: lang === session.sourceLang,
      cues: cuesJson,
      version: 1,
    },
    update: {
      cues: cuesJson,
      version: { increment: 1 },
    },
  });

  return NextResponse.json({ saved: true, newVersion: updated.version });
}
