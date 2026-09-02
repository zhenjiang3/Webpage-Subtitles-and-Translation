// apps/web/src/app/api/translate/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { startTranslateJob } from '@/server/jobs/scheduler';
import type { LanguageCode } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LANGS = ['zh', 'en', 'ja'] as const;

const BodySchema = z.object({
  sessionId: z.string().min(3),
  sourceLang: z.enum(LANGS),
  targetLangs: z.array(z.enum(LANGS)).min(1).max(3),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: '请求参数错误', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: body.sessionId },
    include: { subtitles: { select: { language: true } } },
  });
  if (!session) return NextResponse.json({ error: 'Session 不存在' }, { status: 404 });

  const srcExists = session.subtitles.some((s) => s.language === body.sourceLang);
  if (!srcExists) {
    return NextResponse.json(
      { error: `源语言 ${body.sourceLang} 还没有字幕，请先等待 ASR 完成` },
      { status: 400 },
    );
  }

  // 过滤掉 target = source
  const uniqueTargets = Array.from(
    new Set(body.targetLangs.filter((l) => l !== body.sourceLang)),
  );
  if (uniqueTargets.length === 0) {
    return NextResponse.json({ error: '目标语言不能等同于源语言' }, { status: 400 });
  }

  const createdJobs: Array<{ jobId: string; targetLang: LanguageCode; status: string }> = [];

  // session 状态先切到 TRANSLATING
  await prisma.session.update({ where: { id: body.sessionId }, data: { status: 'TRANSLATING' } });

  for (const targetLang of uniqueTargets) {
    // 已存在相同目标语的 job（PENDING/RUNNING）就不再创建
    const running = await prisma.job.findFirst({
      where: {
        sessionId: body.sessionId,
        type: 'TRANSLATE',
        targetLang,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });

    if (running) {
      createdJobs.push({ jobId: running.id, targetLang, status: running.status });
      continue;
    }

    const job = await prisma.job.create({
      data: {
        sessionId: body.sessionId,
        type: 'TRANSLATE',
        targetLang,
        status: 'PENDING',
      },
    });
    createdJobs.push({ jobId: job.id, targetLang, status: 'RUNNING' });
    startTranslateJob(body.sessionId, job.id, body.sourceLang, targetLang);
  }

  return NextResponse.json({ jobs: createdJobs }, { status: 202 });
}
