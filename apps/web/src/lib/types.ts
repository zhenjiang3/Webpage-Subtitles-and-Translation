// 前端与后端共享的核心类型
// 保持最小化，避免与 Prisma 生成的类型循环引用

export type LanguageCode = 'zh' | 'en' | 'ja';

export interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerTag?: string;
  confidence?: number;
}

export interface SubtitleData {
  id?: string;
  language: LanguageCode;
  isSource: boolean;
  version: number;
  cues: SubtitleCue[];
  updatedAt?: string;
}

export interface SessionSummary {
  id: string;
  videoName: string;
  durationSec?: number | null;
  sourceLang?: LanguageCode | null;
  status: SessionStatusValue;
  createdAt: string;
}

export type SessionStatusValue =
  | 'UPLOADING'
  | 'PREPROCESSING'
  | 'ASR_IN_PROGRESS'
  | 'READY'
  | 'TRANSLATING'
  | 'DONE'
  | 'ERROR';

export type JobStatusValue = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type JobTypeValue = 'ASR' | 'TRANSLATE';

export interface JobProgress {
  jobId: string;
  type: JobTypeValue;
  targetLang?: LanguageCode;
  status: JobStatusValue;
  progress: number; // 0-100
  stage?: string;
  sessionStatus: SessionStatusValue;
  errorLog?: string;
}

export interface UploadResponse {
  sessionId: string;
  jobId: string;
  redirectTo: string;
}

export interface SubtitlesResponse {
  session: SessionSummary & { videoSizeBytes?: string };
  subtitles: SubtitleData[];
}
