// Subtitle.cues 在 SQLite 里存为 JSON 字符串，这里提供统一的编解码 + Zod 校验
import { z } from 'zod';
import type { SubtitleCue } from '@/lib/types';

const CueSchema = z.object({
  index: z.number().int().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  speakerTag: z.string().optional(),
  confidence: z.number().optional(),
});

export const CueArraySchema = z.array(CueSchema);

export function encodeCues(cues: SubtitleCue[]): string {
  return JSON.stringify(cues);
}

/**
 * 解码 DB 中的 cues JSON 字符串。
 * 若为空或非法，返回空数组（调用方可以选择报错或兜底）。
 */
export function decodeCues(raw: string | null | undefined): SubtitleCue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const validated = CueArraySchema.safeParse(parsed);
    if (validated.success) return validated.data;
    // 降级：即使不合 schema，至少返回能迭代的数组
    if (Array.isArray(parsed)) return parsed as SubtitleCue[];
    return [];
  } catch {
    return [];
  }
}
