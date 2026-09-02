/**
 * V1 内存任务调度器
 * - 无 BullMQ/Redis，仅在同一 Node 进程内用 Promise 后台执行
 * - 任务状态写 SQLite（Job 表），前端轮询
 * - 并发限制：ASR 同时 1 个、翻译同时 2 个（避免打爆 API/带宽）
 *
 * V2 再换 BullMQ + Redis 做分布式
 */

import { prisma } from '@/server/db/prisma';
import type { LanguageCode, SubtitleCue } from '@/lib/types';
import { secToMs } from '@/lib/time';
import { extractAudioTrack, probeVideo } from '@/server/ffmpeg';
import { createAsrProvider } from '@/server/asr';
import { createTranslatorProvider, translateInBatches } from '@/server/translator';
import { getSessionPaths } from '@/server/storage/local.storage';
import { encodeCues } from '@/server/db/cues-codec';

// ==================== 并发控制（信号量） ====================
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];
  constructor(permits: number) {
    this.permits = permits;
  }
  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((res) => this.waiting.push(res));
  }
  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.permits += 1;
  }
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.acquire().then(() => fn().finally(() => this.release()));
  }
}

const ASR_LOCK = new Semaphore(1);
const TRANS_LOCK = new Semaphore(2);

// ==================== 进度更新辅助（枚举用字符串代替 Prisma enum） ====================

type JobStatusValue = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

async function setJobRunning(jobId: string, stage?: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'RUNNING' as JobStatusValue, startedAt: new Date(), progress: 0, stage },
  });
}

async function updateProgress(jobId: string, progress: number, stage?: string) {
  await prisma.job.updateMany({
    where: { id: jobId, status: 'RUNNING' as JobStatusValue },
    data: { progress: Math.max(0, Math.min(100, Math.round(progress))), stage },
  });
}

async function setJobSuccess(jobId: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'SUCCESS' as JobStatusValue, progress: 100, finishedAt: new Date(), stage: '完成' },
  });
}

async function setJobFailed(jobId: string, error: unknown) {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'FAILED' as JobStatusValue,
      finishedAt: new Date(),
      errorLog: msg.slice(0, 20000),
      stage: '失败',
    },
  });
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { sessionId: true } });
  if (job) {
    await prisma.session.update({
      where: { id: job.sessionId },
      data: { status: 'ERROR', errorMessage: msg.slice(0, 500) },
    });
  }
}

// ==================== 对外 API：启动任务 ====================

export function startAsrPipeline(sessionId: string, jobId: string): void {
  ASR_LOCK.withLock(() => runAsrPipeline(sessionId, jobId)).catch((e) =>
    setJobFailed(jobId, e),
  );
}

export function startTranslateJob(
  sessionId: string,
  jobId: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): void {
  TRANS_LOCK.withLock(() => runTranslateJob(sessionId, jobId, sourceLang, targetLang)).catch((e) =>
    setJobFailed(jobId, e),
  );
}

// ==================== 核心流程：ASR Pipeline ====================

async function runAsrPipeline(sessionId: string, jobId: string) {
  await setJobRunning(jobId, '初始化...');

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`Session ${sessionId} 不存在`);

  // Step 1: 预处理
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'PREPROCESSING' } });
  await updateProgress(jobId, 5, '视频预处理中：读取元信息...');

  const paths = getSessionPaths(sessionId);
  const probe = await probeVideo(session.videoPath);

  const maxDur = parseInt(process.env.MAX_DURATION_SEC ?? '1800', 10);
  if (probe.durationSec > maxDur) {
    throw new Error(
      `视频时长 ${Math.round(probe.durationSec)}s 超过上限 ${maxDur}s（${Math.round(maxDur / 60)} 分钟）`,
    );
  }

  await updateProgress(jobId, 10, '视频预处理中：提取音轨...');
  await extractAudioTrack(session.videoPath, paths.audioPath);
  await prisma.session.update({
    where: { id: sessionId },
    data: { audioPath: paths.audioPath, durationSec: Math.round(probe.durationSec) },
  });

  // Step 2: ASR
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'ASR_IN_PROGRESS' } });
  const asr = createAsrProvider();
  const result = await asr.transcribe(paths.audioPath, {
    onProgress: (pct, stage) => updateProgress(jobId, 15 + pct * 0.75, stage),
  });

  // Step 3: 写入 Subtitle（cues → JSON string）
  await updateProgress(jobId, 92, '保存字幕数据...');
  const cues: SubtitleCue[] = result.segments
    .map((seg, i) => ({
      index: i + 1,
      startMs: secToMs(seg.start),
      endMs: secToMs(seg.end),
      text: seg.text,
    }))
    .filter((c) => c.startMs < c.endMs && c.text.trim().length > 0);

  const cuesJson = encodeCues(cues);

  // V1 Prisma schema 使用 @@unique + String cues；手动 upsert
  const existing = await prisma.subtitle.findUnique({
    where: { sessionId_language: { sessionId, language: result.language } },
  });
  if (existing) {
    await prisma.subtitle.update({
      where: { id: existing.id },
      data: { isSource: true, cues: cuesJson, version: { increment: 1 } },
    });
  } else {
    await prisma.subtitle.create({
      data: {
        sessionId,
        language: result.language,
        isSource: true,
        cues: cuesJson,
        version: 1,
      },
    });
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      sourceLang: result.language,
      status: 'READY',
      durationSec: Math.round(result.durationSec || probe.durationSec),
    },
  });

  await setJobSuccess(jobId);
}

// ==================== 核心流程：翻译 ====================

async function runTranslateJob(
  sessionId: string,
  jobId: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
) {
  await setJobRunning(jobId, `准备翻译为 ${targetLang}...`);
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'TRANSLATING' } });

  const src = await prisma.subtitle.findUnique({
    where: { sessionId_language: { sessionId, language: sourceLang } },
  });
  if (!src) throw new Error(`未找到源语言字幕：${sourceLang}`);

  // cues JSON 解码
  const { CueArraySchema } = await import('@/server/db/cues-codec');
  const srcCues = (() => {
    try {
      const p = JSON.parse(src.cues);
      const v = CueArraySchema.safeParse(p);
      return v.success ? v.data : (Array.isArray(p) ? (p as SubtitleCue[]) : []);
    } catch {
      return [] as SubtitleCue[];
    }
  })();

  const texts = srcCues.map((c) => c.text);

  const provider = createTranslatorProvider();
  const translatedTexts = await translateInBatches(
    provider,
    { sourceLang, targetLang, texts },
    50,
    (done: number, total: number) => {
      const pct = (done / total) * 100;
      void updateProgress(jobId, pct, `翻译中：${done}/${total}`);
    },
  );

  await updateProgress(jobId, 95, '保存翻译结果...');
  const translatedCues: SubtitleCue[] = srcCues.map((cue, i) => ({
    ...cue,
    text: translatedTexts[i] ?? cue.text,
  }));

  const translatedJson = encodeCues(translatedCues);
  const existing = await prisma.subtitle.findUnique({
    where: { sessionId_language: { sessionId, language: targetLang } },
  });
  if (existing) {
    await prisma.subtitle.update({
      where: { id: existing.id },
      data: { isSource: false, cues: translatedJson, version: { increment: 1 } },
    });
  } else {
    await prisma.subtitle.create({
      data: {
        sessionId,
        language: targetLang,
        isSource: false,
        cues: translatedJson,
        version: 1,
      },
    });
  }

  // 完成所有翻译 job 后切到 DONE
  const runningTranslate = await prisma.job.count({
    where: {
      sessionId,
      type: 'TRANSLATE',
      status: { in: ['PENDING', 'RUNNING'] as JobStatusValue[] },
      id: { not: jobId },
    },
  });
  if (runningTranslate === 0) {
    await prisma.session.update({ where: { id: sessionId }, data: { status: 'DONE' } });
  }

  await setJobSuccess(jobId);
}
