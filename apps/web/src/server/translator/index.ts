import type { TranslatorProvider } from './types';
import { DeeplTranslatorProvider, translateInBatches } from './deepl.provider';
import { XenovaNllbTranslatorProvider, XENOVA_BATCH_SIZE } from './xenova-nllb.provider';

export type { TranslateBatchInput } from './types';
export { translateInBatches, XENOVA_BATCH_SIZE };

export function createTranslatorProvider(): TranslatorProvider {
  const provider = process.env.TRANSLATOR_PROVIDER ?? 'deepl';
  switch (provider) {
    case 'deepl':
      return new DeeplTranslatorProvider(process.env.DEEPL_API_KEY ?? '');
    case 'xenova-nllb':
      return new XenovaNllbTranslatorProvider();
    case 'deepseek':
      // 留占位：云端 DeepSeek Chat 翻译（V1 用户如提供 Key 再实现）
      throw new Error(
        'DeepSeek Chat translator provider is NOT implemented yet. ' +
          'Please use xenova-nllb (local free) or deepl (cloud API) for now.',
      );
    case 'google':
      throw new Error('Google Translate provider is not implemented in V1.');
    default:
      throw new Error(`Unknown TRANSLATOR_PROVIDER: ${provider}`);
  }
}
