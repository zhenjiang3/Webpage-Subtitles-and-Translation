import type { AsrProvider } from './types';
import { OpenAiWhisperProvider } from './openai-whisper.provider';
import { WhisperCppProvider } from './whispercpp.provider';

/**
 * ASR 提供者工厂
 *  3 种实现（按是否要 Key 排序）：
 *    1. whisper-cpp    → 本地 whisper-cli.exe + ggml-*.bin（免费零 API，⭐ 方案 A 推荐）
 *    2. openai-whisper → 云端 Whisper API（付费，$0.006/min，精度最高）
 */
export function createAsrProvider(): AsrProvider {
  const provider = process.env.ASR_PROVIDER ?? 'openai-whisper';
  switch (provider) {
    case 'openai-whisper':
      return new OpenAiWhisperProvider(process.env.OPENAI_API_KEY ?? '');
    case 'whisper-cpp':
      return new WhisperCppProvider();
    case 'local-whisper':
      throw new Error('Local Faster-Whisper provider is not implemented in V1.');
    default:
      throw new Error(`Unknown ASR_PROVIDER: ${provider}`);
  }
}
