// apps/web/src/app/api/jobs/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    include: { session: { select: { status: true } } },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job 不存在' }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    type: job.type,
    targetLang: job.targetLang ?? undefined,
    status: job.status,
    progress: job.progress,
    stage: job.stage ?? undefined,
    errorLog: job.errorLog ?? undefined,
    sessionStatus: job.session.status,
  });
}
