'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Plyr from 'plyr';
import { ArrowLeft, RefreshCcw, AlertTriangle, Languages, Bug, Copy } from 'lucide-react';
import type { LanguageCode, JobProgress, SubtitleCue, SubtitleData } from '@/lib/types';
import { formatPlaybackTime } from '@/lib/time';
import { LANGUAGES, getLanguageLabel } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { VideoPlayer, findActiveCueIndex } from '@/components/player/VideoPlayer';
import { SubtitleList } from '@/components/editor/SubtitleList';
import { TranslatePanel } from '@/components/editor/TranslatePanel';
import { ExportMenu } from '@/components/editor/ExportMenu';

interface Params {
  params: Promise<{ sessionId: string }>;
}

// ================ 顶部状态栏 ================
function StatusBanner({
  status,
  errorMsg,
  asrProgress,
  translateJobs,
}: {
  status: string;
  errorMsg?: string | null;
  asrProgress: number;
  translateJobs: JobProgress[];
}) {
  if (status === 'ERROR' || errorMsg) {
    return (
      <div className="flex gap-3 items-start rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold">处理失败</p>
          <p className="opacity-95 whitespace-pre-wrap break-words leading-relaxed">
            {errorMsg ?? '未知错误，请重新上传。下方会显示完整报错堆栈，可直接复制给开发者定位。'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'UPLOADING' || status === 'PREPROCESSING') {
    return (
      <BannerInfo>视频预处理中，请稍候...（{status}）</BannerInfo>
    );
  }

  if (status === 'ASR_IN_PROGRESS') {
    return (
      <BannerInfo>
        <div className="flex items-center gap-3 w-full">
          <span className="inline-flex items-center gap-2 flex-shrink-0">
            <RefreshCcw className="w-4 h-4 animate-spin text-primary" />
            AI 语音识别中
          </span>
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, asrProgress)}%` }}
            />
          </div>
          <span className="tabular-nums text-xs text-muted-foreground flex-shrink-0">
            {asrProgress}%
          </span>
        </div>
      </BannerInfo>
    );
  }

  if (status === 'TRANSLATING') {
    const running = translateJobs.filter((j) => j.status === 'RUNNING' || j.status === 'PENDING');
    return (
      <BannerInfo>
        <div className="space-y-2 w-full">
          <p className="inline-flex items-center gap-2 text-sm">
            <Languages className="w-4 h-4 text-primary animate-pulse" />
            字幕翻译中...
          </p>
          {running.map((j) => (
            <div key={j.jobId} className="flex items-center gap-3">
              <span className="text-xs min-w-16">
                {j.targetLang ? `${LANGUAGES.find((l) => l.code === j.targetLang)?.flag} ${getLanguageLabel(j.targetLang)}` : j.type}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${j.progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                {j.progress}%
              </span>
            </div>
          ))}
        </div>
      </BannerInfo>
    );
  }

  if (status === 'READY') {
    return (
      <BannerInfo tone="success">✅ 字幕识别完成！你可以编辑字幕，或选择目标语言开始翻译。</BannerInfo>
    );
  }
  if (status === 'DONE') {
    return (
      <BannerInfo tone="success">🎉 翻译完成！现在可以在下方切换不同语言查看，或直接导出。</BannerInfo>
    );
  }
  return null;
}

function BannerInfo({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'success';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'info' && 'border-primary/30 bg-primary/5 text-primary-foreground/90',
        tone === 'success' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {children}
    </div>
  );
}

// ================ 主页面 ================
export default function EditorPage(props: Params) {
  // 由于 params 是 Promise，用一层 hook 封装在客户端层取
  const [sessionId, setSessionId] = useState<string>('');
  const queryClient = useQueryClient();
  const plyrRef = useRef<Plyr | null>(null);

  // 解析 sessionId（Next 15 params 是 Promise）
  useEffect(() => {
    (async () => {
      const p = await props.params;
      setSessionId(p.sessionId);
    })();
  }, [props.params]);

  // ----------- 轮询：拉取 session 信息 + 字幕 -----------
  const {
    data: subtitleData,
    isLoading: loadingSession,
  } = useQuery({
    queryKey: ['subtitles', sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/subtitles/${sessionId}`);
      if (!res.ok) throw new Error(`加载失败 ${res.status}`);
      return (await res.json()) as {
        session: {
          id: string;
          videoName: string;
          durationSec: number | null;
          sourceLang: LanguageCode | null;
          status: string;
          errorMessage?: string | null;
          createdAt: string;
        };
        subtitles: SubtitleData[];
      };
    },
    enabled: !!sessionId,
    refetchInterval: (q) => {
      const status = q.state.data?.session.status ?? '';
      // 未完成阶段：每 2 秒轮询
      if (
        ['UPLOADING', 'PREPROCESSING', 'ASR_IN_PROGRESS', 'TRANSLATING'].includes(status)
      )
        return 2000;
      return false;
    },
  });

  // ----------- 额外轮询：session 所有 jobs（进度 + 失败堆栈） -----------
  const { data: jobsData } = useQuery({
    queryKey: ['session-jobs', sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/jobs`);
      if (!res.ok) return { jobs: [] as Array<{ jobId: string; type: string; status: string; progress: number; stage?: string; targetLang?: string; errorLog?: string }> };
      const json = (await res.json()) as {
        jobs: Array<{ jobId: string; type: string; status: string; progress: number; stage?: string; targetLang?: string; errorLog?: string }>;
      };
      return json;
    },
    enabled: !!sessionId,
    refetchInterval: 2000,
  });
  const jobs = jobsData?.jobs ?? [];
  const asrProgress =
    (jobs.find((j) => j.type === 'ASR')?.progress) ?? 0;
  const failedJobs = jobs.filter((j) => j.status === 'FAILED');
  const firstFailedJob = failedJobs[0];
  const bannerErrorMsg =
    subtitleData?.session.errorMessage ||
    firstFailedJob?.errorLog?.split(/\r?\n/).find((l) => l.trim().length > 0) ||
    null;

  // ----------- 当前语言切换（Tab） -----------
  const availableLangs = useMemo<LanguageCode[]>(
    () => subtitleData?.subtitles.map((s) => s.language as LanguageCode) ?? [],
    [subtitleData],
  );
  const [activeLang, setActiveLang] = useState<LanguageCode | null>(null);
  useEffect(() => {
    if (!activeLang && availableLangs.length > 0) {
      // 优先源语言
      const source = subtitleData?.subtitles.find((s) => s.isSource);
      setActiveLang(source?.language ?? availableLangs[0]);
    } else if (activeLang && !availableLangs.includes(activeLang)) {
      const source = subtitleData?.subtitles.find((s) => s.isSource);
      setActiveLang(source?.language ?? availableLangs[0] ?? null);
    }
  }, [availableLangs, activeLang, subtitleData?.subtitles]);

  const activeSubtitle = useMemo<SubtitleData | undefined>(
    () => subtitleData?.subtitles.find((s) => s.language === activeLang),
    [subtitleData, activeLang],
  );

  // ----------- 本地 optimistic cues（用户编辑用）+ 自动保存 -----------
  const [localCues, setLocalCues] = useState<SubtitleCue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 当 activeSubtitle 从服务端更新时（version 改变），回填到 localCues
  useEffect(() => {
    if (!activeSubtitle) return;
    setLocalCues(activeSubtitle.cues);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubtitle?.id, activeSubtitle?.version]);

  // ----------- 保存字幕 PUT /api/subtitles/:sessionId -----------
  const saveMutation = useMutation({
    mutationFn: async (cues: SubtitleCue[]) => {
      if (!activeLang) throw new Error('未选择语言');
      const res = await fetch(`/api/subtitles/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: activeLang, cues }),
      });
      if (!res.ok) throw new Error(`保存失败 ${res.status}`);
      return (await res.json()) as { saved: boolean; newVersion: number };
    },
    onMutate: () => {
      setSaving(true);
    },
    onSuccess: () => {
      setSaving(false);
      setDirty(false);
      setLastSavedAt(Date.now());
      // 触发 React Query 从服务端拉最新版本
      void queryClient.invalidateQueries({ queryKey: ['subtitles', sessionId] });
    },
    onError: () => {
      setSaving(false);
    },
  });

  // 防抖自动保存（debounce 1.5s）
  const scheduleSave = (cues: SubtitleCue[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMutation.mutate(cues);
    }, 1500);
  };

  const onUpdateCue = (i: number, patch: Partial<SubtitleCue>) => {
    setLocalCues((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
    setDirty(true);
    scheduleSave(
      // 稍后使用最新 cues，这里在 timer 里从最新 state 取
      localCues.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  };

  // ----------- 视频播放器状态 -----------
  const [currentMs, setCurrentMs] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const activeCueIdx = useMemo(
    () => findActiveCueIndex(localCues, currentMs),
    [localCues, currentMs],
  );
  const jumpToCue = (cue: SubtitleCue) => {
    const seconds = cue.startMs / 1000;
    if (plyrRef.current) {
      plyrRef.current.currentTime = seconds;
      // play() 在 Plyr 文档中通常返回 Promise<void>，老版本返回 void；用 Promise.resolve 统一处理避免 catch 类型报错
      Promise.resolve(plyrRef.current.play()).catch(() => {});
    }
  };

  // ----------- 翻译功能 -----------
  const translateMutation = useMutation({
    mutationFn: async (targets: LanguageCode[]) => {
      const src = subtitleData?.session.sourceLang;
      if (!src) throw new Error('源语言未知');
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          sourceLang: src,
          targetLangs: targets,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `翻译请求失败 ${res.status}`);
      }
      return (await res.json()) as { jobs: Array<{ jobId: string; targetLang: LanguageCode; status: string }> };
    },
    onSuccess: () => {
      // 切到轮询模式
      void queryClient.invalidateQueries({ queryKey: ['subtitles', sessionId] });
    },
  });

  // ----------- 视频 URL -----------
  const videoUrl = sessionId ? `/api/video/${sessionId}` : '';

  // ----------- 占位：jobs progress（已通过 session-jobs 查询填充 asrProgress / translateJobs，见上方） -----------

  if (!sessionId || loadingSession) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-sm text-muted-foreground animate-pulse">加载中...</div>
      </div>
    );
  }

  const session = subtitleData?.session;
  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="max-w-md rounded-xl border p-6 text-center">
          <p className="font-semibold">链接无效或会话已过期</p>
          <p className="mt-2 text-sm text-muted-foreground">
            请返回首页重新上传视频。如果 URL 是手动输入的，请检查是否复制完整。
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
      </div>
    );
  }

  const showEditor = session.status === 'READY' || session.status === 'TRANSLATING' || session.status === 'DONE';
  const statusError = session.status === 'ERROR';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b sticky top-0 z-20 bg-background/80 backdrop-blur">
        <div className="container h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
          <div className="h-4 w-px bg-border mx-2" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{session.videoName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {session.durationSec
                ? `时长 ${formatPlaybackTime(session.durationSec * 1000)}`
                : '时长读取中...'}
              {session.sourceLang
                ? ` · 识别语言：${getLanguageLabel(session.sourceLang)}`
                : null}
            </p>
          </div>
          <ExportMenu
            sessionId={session.id}
            availableLanguages={availableLangs}
            sourceLang={session.sourceLang}
          />
        </div>
      </header>

      {/* Main */}
      <main className="container py-6 flex-1 flex flex-col gap-5">
        <StatusBanner
          status={session.status}
          errorMsg={bannerErrorMsg}
          asrProgress={asrProgress}
          translateJobs={jobs as JobProgress[]}
        />

        {/* Job 失败堆栈面板（复制粘贴给开发者定位） */}
        {failedJobs.length > 0 ? (
          <FailedJobsDebugPanel items={failedJobs as Array<{ type: string; jobId: string; targetLang?: string; stage?: string; errorLog?: string }>} />
        ) : null}

        {/* 语言 Tab 切换 */}
        {showEditor && availableLangs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {availableLangs.map((code) => {
              const s = subtitleData.subtitles.find((x) => x.language === code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setActiveLang(code)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
                    activeLang === code && 'bg-primary text-primary-foreground border-primary',
                    activeLang !== code && 'bg-background hover:bg-muted border-border',
                  )}
                >
                  <span>{LANGUAGES.find((l) => l.code === code)?.flag}</span>
                  <span>{getLanguageLabel(code)}</span>
                  {s?.isSource && (
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded', activeLang === code ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>
                      原文
                    </span>
                  )}
                </button>
              );
            })}
            {dirty && (
              <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                * 有未保存的修改
              </span>
            )}
          </div>
        )}

        {/* 主体：播放器 + 字幕表 */}
        {showEditor ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
            {/* 左：播放器 + 翻译面板 */}
            <div className="lg:col-span-3 space-y-5">
              <VideoPlayer
                videoUrl={videoUrl}
                plyrRef={(p) => {
                  plyrRef.current = p;
                }}
                currentCueIndex={activeCueIdx}
                onTimeUpdate={(ms) => setCurrentMs(ms)}
              />

              {session.status === 'READY' || session.status === 'TRANSLATING' || session.status === 'DONE' ? (
                <TranslatePanel
                  sourceLang={session.sourceLang}
                  currentLanguages={availableLangs}
                  disabled={translateMutation.isPending}
                  onTranslate={async (targets) => {
                    await translateMutation.mutateAsync(targets);
                  }}
                />
              ) : null}

              {translateMutation.isError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  翻译失败：{translateMutation.error instanceof Error ? translateMutation.error.message : String(translateMutation.error)}
                </div>
              )}
            </div>

            {/* 右：字幕列表 */}
            <div className="lg:col-span-2 h-[calc(100vh-12rem)] min-h-[520px] rounded-xl border bg-card overflow-hidden flex flex-col">
              <SubtitleList
                cues={localCues}
                currentIndex={activeCueIdx}
                selectedIndex={selectedIdx}
                onSelectIndex={(i) => setSelectedIdx(i)}
                onJumpToCue={jumpToCue}
                onUpdateCue={onUpdateCue}
                saving={saving || saveMutation.isPending}
                lastSavedAt={lastSavedAt}
              />
            </div>
          </div>
        ) : statusError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center space-y-5">
            <div>
              <p className="text-lg font-semibold text-destructive">视频处理失败</p>
              <p className="mt-2 text-sm text-muted-foreground break-words whitespace-pre-wrap">
                {bannerErrorMsg ?? '请检查视频是否损坏，或尝试转码后重新上传。详细报错信息请见下方「失败诊断信息」面板。'}
              </p>
            </div>
            {failedJobs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                提示：2 秒后会自动加载最新的失败堆栈；如长时间无堆栈，可将 PowerShell 控制台从 POST /api/upload 开始的新日志截图或复制给开发者。
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                返回首页重新上传
              </Link>
              {firstFailedJob?.errorLog ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(firstFailedJob.errorLog ?? '');
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition"
                >
                  <Copy className="w-4 h-4" /> 复制完整报错堆栈
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          // 处理中占位动画
          <ProcessingSkeleton status={session.status} />
        )}
      </main>
    </div>
  );
}

function FailedJobsDebugPanel({
  items,
}: {
  items: Array<{ type: string; jobId: string; targetLang?: string; stage?: string; errorLog?: string }>;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Bug className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="font-semibold">失败诊断信息（发送给开发者即可快速定位）</span>
        </div>
        <span className="text-xs text-muted-foreground">
          共 {items.length} 个失败任务
        </span>
      </div>
      {items.map((job) => (
        <div key={job.jobId} className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>
              <span className="font-mono bg-muted rounded px-1.5 py-0.5 mr-2">{job.type}</span>
              {job.targetLang ? (
                <span>目标: {LANGUAGES.find((l) => l.code === job.targetLang)?.label ?? job.targetLang}</span>
              ) : null}
              {job.stage ? <span className="ml-3">阶段: {job.stage}</span> : null}
              <span className="ml-3">Job ID: {job.jobId}</span>
            </div>
            {job.errorLog ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(job.errorLog ?? '');
                    setCopiedId(job.jobId);
                    setTimeout(() => setCopiedId((c) => (c === job.jobId ? null : c)), 1800);
                  } catch {
                    /* ignore */
                  }
                }}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted transition"
              >
                <Copy className="w-3.5 h-3.5" /> {copiedId === job.jobId ? '已复制' : '复制堆栈'}
              </button>
            ) : null}
          </div>
          {job.errorLog ? (
            <pre className="rounded-md bg-black/5 dark:bg-white/5 border text-[11px] leading-relaxed p-3 overflow-auto max-h-[420px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
{job.errorLog}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">（无堆栈信息，可能是前端处理阶段报错）</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ProcessingSkeleton({ status }: { status: string }) {
  return (
    <div className="rounded-2xl border p-12 text-center space-y-5">
      <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 grid place-items-center animate-pulse">
        <RefreshCcw className="w-7 h-7 text-primary animate-spin" />
      </div>
      <h2 className="text-xl font-semibold">AI 正在处理你的视频...</h2>
      <p className="text-sm text-muted-foreground">
        当前阶段：<b className="text-foreground">{status}</b> · 页面会自动刷新，无需手动操作
      </p>
      <div className="max-w-md mx-auto">
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary w-1/2 animate-pulse" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        5 分钟以内的视频通常 1 分钟内可识别完成。请保持此页面打开。
      </p>
    </div>
  );
}
