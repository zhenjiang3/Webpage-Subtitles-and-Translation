import type { AsrProvider } from './types';
import { OpenAiWhisperProvider } from './openai-whisper.provider';

/**
 * ASR 提供者工厂
 * V1 只实现了 OpenAI Whisper；本地 faster-whisper 后续加
 */
export function createAsrProvider(): AsrProvider {
  const provider = process.env.ASR_PROVIDER ?? 'openai-whisper';
  switch (provider) {
    case 'openai-whisper':
      return new OpenAiWhisperProvider(process.env.OPENAI_API_KEY ?? '');
    case 'local-whisper':
      throw new Error('Local Faster-Whisper provider is not implemented in V1.');
    default:
      throw new Error(`Unknown ASR_PROVIDER: ${provider}`);
  }
}
