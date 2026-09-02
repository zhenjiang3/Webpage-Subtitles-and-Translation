import type { TranslatorProvider } from './types';
import { DeeplTranslatorProvider } from './deepl.provider';

export function createTranslatorProvider(): TranslatorProvider {
  const provider = process.env.TRANSLATOR_PROVIDER ?? 'deepl';
  switch (provider) {
    case 'deepl':
      return new DeeplTranslatorProvider(process.env.DEEPL_API_KEY ?? '');
    case 'google':
      throw new Error('Google Translate provider is not implemented in V1.');
    default:
      throw new Error(`Unknown TRANSLATOR_PROVIDER: ${provider}`);
  }
}
