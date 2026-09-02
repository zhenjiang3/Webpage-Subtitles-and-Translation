import fs from 'node:fs';
import FormData from 'form-data';
import { fetch } from 'undici';
import type { LanguageCode } from '@/lib/types';
import { getWhisperLangHint } from '@/lib/languages';
import type { AsrProvider, AsrResult, AsrSegment } from './types';

/**
 * OpenAI Whisper API 提供者
 * Docs: https://platform.openai.com/docs/api-reference/audio/createTranscription
 * 价格（2026 参考）：$0.006 / 分钟 → 1 小时约 ¥2.5，V1 足够便宜
 */
export class OpenAiWhisperProvider implements AsrProvider {
  readonly name = 'openai-whisper';

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAiWhisperProvider');
  }

  async transcribe(
    audioPath: string,
    opts: { langHint?: LanguageCode; onProgress?: (pct: number, stage: string) => void },
  ): Promise<AsrResult> {
    opts.onProgress?.(5, '准备上传音频到 OpenAI...');

    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    if (opts.langHint) form.append('language', getWhisperLangHint(opts.langHint));

    opts.onProgress?.(15, '上传中，识别中...');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...form.getHeaders(),
      },
      body: form as unknown as BodyInit,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Whisper API ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      language: string;
      duration?: number;
      segments?: AsrSegment[];
      text?: string;
    };

    opts.onProgress?.(90, '识别完成，后处理中...');

    const segments: AsrSegment[] =
      json.segments?.map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
        text: (s.text ?? '').trim(),
        words: s.words,
      })) ?? [];

    return {
      language: normalizeLang(json.language),
      durationSec: json.duration ?? 0,
      segments,
    };
  }
}

function normalizeLang(lang: string | undefined): LanguageCode {
  if (!lang) return 'zh';
  const l = lang.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('ja') || l.startsWith('jp')) return 'ja';
  if (l.startsWith('en')) return 'en';
  return 'zh'; // 兜底，用户可后续在编辑器里改
}
