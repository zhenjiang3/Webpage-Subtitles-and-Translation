'use client';

import { useMemo, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { LANGUAGES } from '@/lib/languages';
import type { LanguageCode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  sourceLang?: LanguageCode | null;
  currentLanguages: LanguageCode[]; // 已拥有字幕的语言
  disabled?: boolean;
  onTranslate: (targets: LanguageCode[]) => Promise<void> | void;
}

export function TranslatePanel({ sourceLang, currentLanguages, disabled, onTranslate }: Props) {
  const [selected, setSelected] = useState<LanguageCode[]>([]);
  const [loading, setLoading] = useState(false);

  const availableTargets = useMemo(
    () => LANGUAGES.filter((l) => l.code !== sourceLang).map((l) => l.code),
    [sourceLang],
  );

  if (!sourceLang) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        尚未识别出源语言，请先等待 ASR 完成。
      </div>
    );
  }

  const toggle = (code: LanguageCode) => {
    setSelected((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code]));
  };

  const submit = async () => {
    if (selected.length === 0 || disabled) return;
    setLoading(true);
    try {
      await onTranslate(selected);
      setSelected([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Languages className="w-4 h-4 text-primary" />
          字幕翻译
        </h3>
        <span className="text-xs text-muted-foreground">
          源语言：<b>{LANGUAGES.find((l) => l.code === sourceLang)?.label}</b>
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        选择一个或多个目标语言，V1 支持中 / 英 / 日三语互译。
      </p>

      <div className="flex flex-wrap gap-2">
        {LANGUAGES.filter((l) => availableTargets.includes(l.code)).map((l) => {
          const has = currentLanguages.includes(l.code);
          const isSel = selected.includes(l.code);
          return (
            <button
              key={l.code}
              type="button"
              disabled={disabled}
              onClick={() => toggle(l.code)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition',
                isSel &&
                  'bg-primary text-primary-foreground border-primary shadow-sm',
                !isSel &&
                  'hover:border-primary/50 hover:bg-accent/40 border-border bg-background',
                has && !isSel && 'ring-1 ring-emerald-500/40',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
              {has && !isSel && <span className="text-[10px] opacity-70">已有</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled || loading || selected.length === 0}
        onClick={submit}
        className={cn(
          'w-full inline-flex justify-center items-center gap-2 rounded-lg py-2 text-sm font-medium',
          'bg-primary text-primary-foreground hover:bg-primary/90 transition',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
        {loading ? '正在翻译...' : `开始翻译 ${selected.length > 0 ? `(${selected.length})` : ''}`}
      </button>
    </div>
  );
}
