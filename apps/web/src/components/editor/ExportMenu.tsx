'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { LANGUAGES, getLanguageLabel } from '@/lib/languages';
import type { LanguageCode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  sessionId: string;
  availableLanguages: LanguageCode[]; // 已经有的字幕语言
  sourceLang?: LanguageCode | null;
}

type Format = 'srt' | 'vtt';

/**
 * 导出下拉菜单：
 *   Format (SRT / VTT) × Language（zh / en / ja 中已有的那些）
 * 每一项点击跳转到 /api/export/... 触发浏览器下载
 */
export function ExportMenu({ sessionId, availableLanguages, sourceLang }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | `${Format}-${LanguageCode}`>(null);

  const options: Array<{ format: Format; lang: LanguageCode; label: string }> = [];
  for (const fmt of ['srt', 'vtt'] as Format[]) {
    for (const lang of availableLanguages) {
      const tag = sourceLang === lang ? ' (原文)' : ' (译文)';
      options.push({
        format: fmt,
        lang,
        label: `${fmt.toUpperCase()} · ${getLanguageLabel(lang)}${tag}`,
      });
    }
  }

  const download = async (fmt: Format, lang: LanguageCode) => {
    const key = `${fmt}-${lang}` as const;
    try {
      setBusy(key);
      const url = `/api/export/${encodeURIComponent(sessionId)}/${fmt}?lang=${lang}`;
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 等待一小会儿模拟下载中
      await new Promise((r) => setTimeout(r, 700));
    } finally {
      setBusy((cur) => (cur === key ? null : cur));
      setOpen(false);
    }
  };

  if (availableLanguages.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
      >
        <Download className="w-4 h-4" /> 导出
      </button>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80"
      >
        <Download className="w-4 h-4" />
        导出
        <svg viewBox="0 0 10 6" className="w-2.5 h-2.5 opacity-70 ml-1" aria-hidden>
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg border bg-popover shadow-lg p-2 z-30">
          <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">选择导出格式与语言</p>
          <ul className="max-h-80 overflow-y-auto">
            {options.map((o) => {
              const key = `${o.format}-${o.lang}` as const;
              const isBusy = busy === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => download(o.format, o.lang)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-sm rounded-md text-left',
                      'hover:bg-accent/60 transition-colors',
                      isBusy && 'opacity-70',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span>{LANGUAGES.find((l) => l.code === o.lang)?.flag ?? '🌐'}</span>
                      <span>{o.label}</span>
                    </span>
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 opacity-70" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
