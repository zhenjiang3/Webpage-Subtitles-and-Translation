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
    const errBuf: Buffer[] = [];
    const child = spawn('ffmpeg', args);
    child.stderr?.on('data', (d) => errBuf.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    child.on('error', (err) => reject(new Error(`ffmpeg 启动失败: ${err.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else {
        const tail = Buffer.concat(errBuf).toString('utf8').trim().slice(-1200);
        reject(
          new Error(
            `ffmpeg extract audio 退出码: ${code}. 输入: ${inputVideo} 输出: ${outputWav}\n` +
              `ffmpeg 最后日志:\n${tail}`,
          ),
        );
      }
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
    child.stdout.on('data', (d) => out.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    child.stderr.on('data', (d) => err.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    child.on('error', (e) => reject(new Error(`ffprobe 启动失败: ${e.message}. 请确认 ffmpeg 已加入系统 PATH 并重启终端。`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else {
        const tail = Buffer.concat(err).toString('utf8').trim().slice(-1200);
        reject(
          new Error(
            `ffprobe 退出码 ${code}. 文件: ${videoPath}\n` +
              (tail ? `ffprobe 日志:\n${tail}` : ''),
          ),
        );
      }
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

/**
 * 检查系统 ffmpeg / ffprobe 是否可用
 *
 * Windows 上先调用 `where.exe ffmpeg/ffprobe` 做「PATH 里有没有」的查询
 * （比直接 spawn('ffmpeg') 更稳：后者在某些 PowerShell / profile / PATH 继承场景里会误报 ENOENT，
 *  而用户手动在终端里敲 ffmpeg -version 却能成功）。
 * Unix 上退化为 `command -v`。
 * 找到文件后，再真实跑一次 `-version` 验证退出码，防止是个空路径/假符号链接。
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  const isWin = process.platform === 'win32';
  async function which(name: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const [bin, args] = isWin
        ? (['where.exe', [name]] as const)
        : (['/bin/sh', ['-c', `command -v -- "${name}"`]] as const);
      try {
        const p = spawn(bin, args, {
          // where.exe 默认会把 PATHEXT 下所有匹配都列出来，可能有多个
          windowsHide: true,
        });
        const out: Buffer[] = [];
        p.stdout?.on('data', (d) => out.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        p.on('error', () => resolve(null));
        p.on('exit', (code) => {
          if (code !== 0) return resolve(null);
          const firstLine = Buffer.concat(out)
            .toString('utf8')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .find(Boolean);
          resolve(firstLine ?? null);
        });
        setTimeout(() => resolve(null), 4000).unref?.();
      } catch {
        resolve(null);
      }
    });
  }
  async function runsOk(cmd: string, args: string[]): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const p = spawn(cmd, args, { windowsHide: true });
        p.on('error', () => resolve(false));
        p.on('exit', (code) => resolve(code === 0));
        setTimeout(() => resolve(false), 5000).unref?.();
      } catch {
        resolve(false);
      }
    });
  }
  const [ff, fp] = await Promise.all([which('ffmpeg'), which('ffprobe')]);
  if (!ff || !fp) return false;
  // where.exe 返回的路径通常带 .exe，直接 spawn 绝对路径绕过所有 PATH 继承问题
  return (await runsOk(ff, ['-version'])) && (await runsOk(fp, ['-version']));
}
