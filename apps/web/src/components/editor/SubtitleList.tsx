'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Save, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPlaybackTime } from '@/lib/time';
import type { SubtitleCue } from '@/lib/types';

interface Props {
  cues: SubtitleCue[];
  currentIndex: number; // 当前播放对应 cue（基于时间）
  selectedIndex: number; // 点击选中的
  onSelectIndex: (i: number) => void;
  onJumpToCue: (cue: SubtitleCue) => void; // 双击或点击跳转
  onUpdateCue: (index: number, patch: Partial<SubtitleCue>) => void; // 本地 optimistic update
  saving?: boolean;
  lastSavedAt?: number | null;
}

/**
 * 字幕列表 — V1 纯 DOM 列表 + 原生滚动，字幕 < 500 条（约 30 分钟视频）完全够用
 * 等 V2 超 1000 条再上虚拟滚动。
 */
export function SubtitleList({
  cues,
  currentIndex,
  selectedIndex,
  onSelectIndex,
  onJumpToCue,
  onUpdateCue,
  saving,
  lastSavedAt,
}: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ text?: string; startMs?: number; endMs?: number }>({});
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  // 当前播放字幕自动滚动可见
  useEffect(() => {
    if (currentIndex >= 0 && editingIdx === null) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex, editingIdx]);

  const startEdit = useCallback((cue: SubtitleCue, i: number) => {
    setEditingIdx(i);
    setDraft({ text: cue.text, startMs: cue.startMs, endMs: cue.endMs });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingIdx(null);
    setDraft({});
  }, []);

  const confirmEdit = useCallback(() => {
    if (editingIdx === null) return;
    const patch: Partial<SubtitleCue> = {};
    if (typeof draft.text === 'string') patch.text = draft.text;
    if (typeof draft.startMs === 'number') patch.startMs = draft.startMs;
    if (typeof draft.endMs === 'number') patch.endMs = draft.endMs;
    onUpdateCue(editingIdx, patch);
    setEditingIdx(null);
    setDraft({});
  }, [editingIdx, draft, onUpdateCue]);

  // Esc 取消编辑，Ctrl+Enter 保存
  useEffect(() => {
    if (editingIdx === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        confirmEdit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editingIdx, cancelEdit, confirmEdit]);

  const colW = useMemo(() => ({ idx: 'w-12', time: 'w-40' }), []);

  return (
    <div className="flex flex-col h-full">
      {/* 表头 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0 z-10">
        <div className={colW.idx}>#</div>
        <div className={colW.time}>开始 → 结束</div>
        <div className="flex-1">文本</div>
        <div className="w-20 text-right">状态</div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {cues.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            暂无字幕，ASR 识别完成后会出现在这里。
          </div>
        ) : (
          cues.map((cue, i) => {
            const isCurrent = i === currentIndex;
            const isSelected = i === selectedIndex;
            const isEditing = i === editingIdx;
            return (
              <div
                key={`${cue.index}-${i}`}
                ref={isCurrent ? activeRowRef : undefined}
                onClick={() => onSelectIndex(i)}
                onDoubleClick={() => {
                  onJumpToCue(cue);
                }}
                className={cn(
                  'group grid grid-cols-[3rem_10rem_1fr_5rem] gap-2 items-start px-3 py-2 border-b transition-colors cursor-pointer',
                  isCurrent && !isEditing && 'bg-primary/8 text-primary',
                  isSelected && !isCurrent && 'bg-accent/40',
                  !isCurrent && !isSelected && 'hover:bg-muted/50',
                  isEditing && 'bg-amber-500/10 ring-1 ring-amber-400/40',
                )}
              >
                {/* 序号 */}
                <div className="pt-1 text-xs tabular-nums text-muted-foreground font-mono">
                  {String(cue.index).padStart(3, '0')}
                </div>

                {/* 时间 */}
                <div className="text-xs tabular-nums font-mono text-muted-foreground">
                  {isEditing ? (
                    <div className="flex flex-col gap-1">
                      <input
                        type="number"
                        className="w-full border rounded px-1.5 py-1 text-foreground text-[11px]"
                        value={Math.round(draft.startMs ?? 0)}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, startMs: parseInt(e.target.value || '0', 10) }))
                        }
                      />
                      <span className="text-center opacity-60">→</span>
                      <input
                        type="number"
                        className="w-full border rounded px-1.5 py-1 text-foreground text-[11px]"
                        value={Math.round(draft.endMs ?? 0)}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, endMs: parseInt(e.target.value || '0', 10) }))
                        }
                      />
                    </div>
                  ) : (
                    <div>
                      <div>{formatPlaybackTime(cue.startMs)}</div>
                      <div className="opacity-80">→ {formatPlaybackTime(cue.endMs)}</div>
                    </div>
                  )}
                </div>

                {/* 文本 */}
                <div className="py-0.5 text-sm leading-snug">
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={draft.text ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                      className="w-full rounded border bg-background px-2 py-1 text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{cue.text}</p>
                  )}
                </div>

                {/* 操作列 */}
                <div className="flex flex-col gap-1 items-end pt-1">
                  {isEditing ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="保存 (Ctrl+Enter)"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmEdit();
                        }}
                        className="p-1 rounded hover:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="取消 (Esc)"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelEdit();
                        }}
                        className="p-1 rounded hover:bg-destructive/15 text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(cue, i);
                      }}
                      className="p-1 rounded opacity-60 hover:opacity-100 hover:bg-muted"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部保存状态 */}
      <div className="px-3 py-2 border-t bg-muted/40 text-xs text-muted-foreground flex items-center justify-between">
        <span>
          共 <b className="text-foreground">{cues.length}</b> 条字幕
        </span>
        <span className="flex items-center gap-1.5">
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 保存中...
            </>
          ) : lastSavedAt ? (
            <>
              <Save className="w-3.5 h-3.5 text-emerald-500" /> 已保存 ·{' '}
              {new Date(lastSavedAt).toLocaleTimeString()}
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
