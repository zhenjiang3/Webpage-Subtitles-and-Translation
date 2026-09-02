// apps/web/src/app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { getSessionPaths, saveBufferToFile } from '@/server/storage/local.storage';
import { startAsrPipeline } from '@/server/jobs/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel 场景最多 5 分钟；V1 本地部署无限

const MAX_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? String(500 * 1024 * 1024), 10);

const ALLOWED_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
]);

const ALLOWED_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: '需要 multipart/form-data 请求' }, { status: 400 });
    }

    // 由于 Next.js 15 App Router 的 formData() 支持 Blob
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `文件过大：${file.size} bytes，上限 ${MAX_BYTES} bytes（500MB）` },
        { status: 413 },
      );
    }

    const fileName = file.name || 'video.mp4';
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: `不支持的文件扩展名：${ext ?? '未知'}。支持：${ALLOWED_EXTS.join(', ')}` },
        { status: 400 },
      );
    }

    // 1) 创建 Session + Job 记录
    const session = await prisma.session.create({
      data: {
        videoName: fileName,
        videoPath: '', // 稍后填充
        videoSizeBytes: BigInt(file.size),
        status: 'UPLOADING',
        jobs: {
          create: { type: 'ASR', status: 'PENDING' },
        },
      },
      include: { jobs: true },
    });

    const asrJob = session.jobs.find((j) => j.type === 'ASR');
    if (!asrJob) return NextResponse.json({ error: '创建 ASR Job 失败' }, { status: 500 });

    // 2) 落盘到 data/uploads/{sessionId}/video.mp4
    const paths = getSessionPaths(session.id);
    const bytes = Buffer.from(await file.arrayBuffer());
    await saveBufferToFile(bytes, paths.videoPath);

    await prisma.session.update({
      where: { id: session.id },
      data: { videoPath: paths.videoPath, status: 'PREPROCESSING' },
    });

    // 3) 异步启动 ASR Pipeline（不阻塞响应）
    startAsrPipeline(session.id, asrJob.id);

    return NextResponse.json(
      {
        sessionId: session.id,
        jobId: asrJob.id,
        redirectTo: `/editor/${session.id}`,
      },
      { status: 202 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** @see z */
export type _ZodUnused = z.ZodNever;
