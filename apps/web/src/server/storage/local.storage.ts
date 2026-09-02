import fs from 'node:fs';
import path from 'node:path';

/**
 * 本地文件存储 — V1 专用
 * 所有文件存放在项目根 data/ 目录下（.gitignore 已忽略）
 */

export interface UploadPaths {
  sessionDir: string;
  videoPath: string;
  audioPath: string;
}

function rootDir() {
  // 从 apps/web 向上 2 层到项目根
  return path.resolve(process.cwd(), '..', '..');
}

function uploadRoot() {
  const dir = process.env.UPLOAD_DIR ?? path.join(rootDir(), 'data', 'uploads');
  return path.isAbsolute(dir) ? dir : path.resolve(rootDir(), dir);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function getSessionPaths(sessionId: string): UploadPaths {
  const sessionDir = path.join(uploadRoot(), sessionId);
  ensureDir(sessionDir);
  return {
    sessionDir,
    videoPath: path.join(sessionDir, 'video.mp4'),
    audioPath: path.join(sessionDir, 'audio.wav'),
  };
}

export function saveStreamToFile(stream: NodeJS.ReadableStream, destPath: string): Promise<void> {
  ensureDir(path.dirname(destPath));
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    stream.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', (err) => reject(err));
    stream.on('error', (err) => {
      out.destroy(err);
      reject(err);
    });
  });
}

export async function saveBufferToFile(buffer: Buffer, destPath: string): Promise<void> {
  ensureDir(path.dirname(destPath));
  await fs.promises.writeFile(destPath, buffer);
}

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

export function getFileSize(p: string): number {
  return fs.statSync(p).size;
}

export function createReadStream(p: string): fs.ReadStream {
  return fs.createReadStream(p);
}
