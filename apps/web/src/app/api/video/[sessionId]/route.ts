// apps/web/src/app/api/video/[sessionId]/route.ts
// — 通过 API 路由代理读取本地视频文件（避免直接暴露 data/uploads 路径）
import { NextResponse } from 'next/server';
import path from 'node:path';
import { createReadStream, fileExists, getFileSize } from '@/server/storage/local.storage';
import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 支持 206 Partial Content（Range 请求）用于 HTML5 视频 seek
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return NextResponse.json({ error: 'Session 不存在' }, { status: 404 });

  const filePath = session.videoPath;
  if (!filePath || !fileExists(filePath)) {
    return NextResponse.json({ error: '视频文件不存在或已被清理' }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mime =
    ext === 'webm'
      ? 'video/webm'
      : ext === 'mov'
        ? 'video/quicktime'
        : ext === 'mkv'
          ? 'video/x-matroska'
          : 'video/mp4';

  const fileSize = getFileSize(filePath);
  const range = req.headers.get('range');

  if (!range) {
    const stream = createReadStream(filePath);
    return new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  // Range: bytes=0-999 或 bytes=1000-
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } });
  }
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  if (start > end || start >= fileSize) {
    return new NextResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${fileSize}` },
    });
  }
  const chunkSize = end - start + 1;
  const rangedStream = createReadStream(filePath, { start, end });

  return new NextResponse(rangedStream as unknown as BodyInit, {
    status: 206,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(chunkSize),
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
