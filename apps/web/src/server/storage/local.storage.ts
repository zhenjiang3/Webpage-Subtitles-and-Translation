import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 本地文件存储 — V1 专用
 * 所有文件存放在项目根 data/ 目录下（.gitignore 已忽略）
 */

export interface UploadPaths {
  sessionDir: string;
  videoPath: string;
  audioPath: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * monorepo 项目根目录（process.cwd 不可靠：它取决于 dev 命令从哪执行，
 *   - 从项目根跑 pnpm --filter @app/web dev → cwd = 项目根 → 向上 ../.. 会出盘符
 *   - 从 apps/web 跑 pnpm dev → cwd = apps/web
 * 所以改为：基于当前文件 apps/web/src/server/storage/local.storage.ts 往上反推
 *   __dirname = apps/web/src/server/storage
 *   向上 4 层 = monorepo 根）
 */
function rootDir() {
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
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

export function createReadStream(p: string, opts?: { start?: number; end?: number }): fs.ReadStream {
  return fs.createReadStream(p, opts);
}
