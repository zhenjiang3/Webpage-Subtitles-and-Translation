// apps/web/src/app/api/sessions/[id]/jobs/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: 'Session 不存在' }, { status: 404 });

  const jobs = await prisma.job.findMany({
    where: { sessionId: id },
    orderBy: [{ createdAt: 'asc' }, { type: 'asc' }],
  });

  return NextResponse.json({
    sessionId: id,
    jobs: jobs.map((j) => ({
      jobId: j.id,
      type: j.type,
      targetLang: j.targetLang ?? undefined,
      status: j.status,
      progress: j.progress,
      stage: j.stage ?? undefined,
      startedAt: j.startedAt?.toISOString?.() ?? undefined,
      finishedAt: j.finishedAt?.toISOString?.() ?? undefined,
      errorLog: j.errorLog ?? undefined,
      createdAt: j.createdAt.toISOString(),
    })),
  });
}
