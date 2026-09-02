import { fetch } from 'undici';
import type { LanguageCode } from '@/lib/types';
import { getDeeplCode } from '@/lib/languages';
import type { TranslateBatchInput, TranslatorProvider } from './types';

/**
 * DeepL API 翻译提供者（V1 首选）
 * Free 版：https://api-free.deepl.com/v2/translate  每月 50 万字符免费
 * Pro  版：https://api.deepl.com/v2/translate
 */
export class DeeplTranslatorProvider implements TranslatorProvider {
  readonly name = 'deepl';
  private readonly endpoint: string;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('DEEPL_API_KEY is required for DeeplTranslatorProvider');
    // Free Key 以 ":fx" 结尾
    this.endpoint = apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
  }

  async translate(input: TranslateBatchInput): Promise<string[]> {
    const { sourceLang, targetLang, texts } = input;
    if (sourceLang === targetLang) return texts.map((t) => t);
    if (texts.length === 0) return [];

    const params = new URLSearchParams();
    texts.forEach((t) => params.append('text', t));
    params.append('source_lang', getDeeplCode(sourceLang).split('-')[0]!); // ZH, EN, JA
    params.append('target_lang', getDeeplCode(targetLang)); // EN-US, ZH, JA
    params.append('formality', 'default');
    params.append('preserve_formatting', '1');
    params.append('tag_handling', 'xml');

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepL API ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      translations: Array<{ text: string; detected_source_language?: string }>;
    };

    return json.translations.map((t) => t.text);
  }
}

/** DeepL 批量上限：每批最多 50 条，避免 URL 超长 */
export const DEEPL_BATCH_SIZE = 50;

export async function translateInBatches(
  provider: TranslatorProvider,
  input: TranslateBatchInput,
  batchSize = DEEPL_BATCH_SIZE,
  onBatchDone?: (done: number, total: number) => void,
): Promise<string[]> {
  const result: string[] = [];
  const total = input.texts.length;
  for (let i = 0; i < total; i += batchSize) {
    const batch = input.texts.slice(i, i + batchSize);
    const translated = await provider.translate({ ...input, texts: batch });
    result.push(...translated);
    onBatchDone?.(result.length, total);
  }
  return result;
}
