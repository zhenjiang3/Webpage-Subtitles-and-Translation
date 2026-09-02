import { spawn } from 'node:child_process';

/**
 * 轻量 ffmpeg 封装 — V1 仅需两个命令：
 *  1. 提取 16kHz 单声道 WAV（供 Whisper 输入）
 *  2. ffprobe 读取视频时长
 * 必须在系统 PATH 中安装 ffmpeg / ffprobe。
 *   Windows: winget install Gyan.FFmpeg
 *   macOS:   brew install ffmpeg
 *   Linux:   sudo apt install ffmpeg
 */

export interface FFProbeInfo {
  durationSec: number;
  resolution?: string; // 1920x1080
  fps?: number;
}

export function extractAudioTrack(inputVideo: string, outputWav: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Whisper 最优输入：PCM 16-bit signed little-endian, 16kHz, mono
    const args = [
      '-y',
      '-i',
      inputVideo,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outputWav,
    ];
    const child = spawn('ffmpeg', args, { stdio: 'ignore' });
    child.on('error', (err) => reject(new Error(`ffmpeg 启动失败: ${err.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg extract audio 退出码: ${code}`));
    });
  });
}

export async function probeVideo(videoPath: string): Promise<FFProbeInfo> {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate:format=duration',
    '-of',
    'json',
    videoPath,
  ];

  const out: Buffer[] = [];
  const err: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffprobe', args);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => reject(new Error(`ffprobe 启动失败: ${e.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffprobe 退出码 ${code}: ${Buffer.concat(err).toString('utf8')}`));
    });
  });

  const json = JSON.parse(Buffer.concat(out).toString('utf8')) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>;
    format?: { duration?: string };
  };

  const stream = json.streams?.[0];
  const durationSec = parseFloat(json.format?.duration ?? '0') || 0;
  const resolution =
    stream?.width && stream?.height ? `${stream.width}x${stream.height}` : undefined;
  const fps = parseFps(stream?.r_frame_rate);

  return { durationSec, resolution, fps };
}

function parseFps(fraction?: string): number | undefined {
  if (!fraction) return undefined;
  const [num, den] = fraction.split('/');
  const n = parseInt(num ?? '0', 10);
  const d = parseInt(den ?? '0', 10);
  if (!n || !d) return undefined;
  return Math.round((n / d) * 100) / 100;
}

/** 检查系统 ffmpeg / ffprobe 是否可用 */
export function isFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version']);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
    setTimeout(() => resolve(false), 5000).unref?.();
  });
}
