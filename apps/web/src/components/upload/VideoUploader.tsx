'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileVideo, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

const MAX_BYTES = 500 * 1024 * 1024; // 500MB
const ALLOWED_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

export function VideoUploader({ className }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setFileName(file.name);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTS.includes(ext)) {
      setStatus('error');
      setError(`不支持的格式：${ext}。支持：${ALLOWED_EXTS.join('、')}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus('error');
      setError('文件超过 500MB 上限');
      return;
    }

    setStatus('uploading');
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // 用 XMLHttpRequest 以便读取上传进度
      const xhr = new XMLHttpRequest();
      const response = await new Promise<any>((resolve, reject) => {
        xhr.open('POST', '/api/upload');
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 90); // 最后 10% 等后端
            setProgress(pct);
          }
        };
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(json);
            else reject(new Error(json.error ?? `HTTP ${xhr.status}`));
          } catch (e) {
            reject(new Error(`解析响应失败: ${xhr.responseText.slice(0, 100)}`));
          }
        };
        xhr.onerror = () => reject(new Error('网络错误，上传失败'));
        xhr.send(formData);
      });

      setProgress(100);
      setStatus('done');
      // 小延时让用户看到 100%
      setTimeout(() => router.push(response.redirectTo), 400);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  };

  useEffect(() => {
    // 粘贴文件支持
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0];
      if (file && file.type.startsWith('video/')) void handleFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <div className={cn('w-full max-w-3xl mx-auto', className)}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          'block cursor-pointer rounded-2xl border-2 border-dashed transition-all p-10 md:p-16 text-center',
          dragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border hover:border-primary/60 hover:bg-muted/40',
          status === 'error' && 'border-destructive/60 bg-destructive/5',
          status === 'done' && 'border-emerald-500/60 bg-emerald-500/5',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.webm,.mkv,.avi,.m4v"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />

        <div className="flex flex-col items-center gap-4">
          <div
            className={cn(
              'w-16 h-16 rounded-2xl grid place-items-center transition-colors',
              dragging ? 'bg-primary text-white' : 'bg-primary/10 text-primary',
            )}
          >
            <Upload className="w-8 h-8" />
          </div>

          <div>
            <p className="text-lg md:text-xl font-semibold">
              {status === 'done' ? '上传完成，正在跳转...' : '拖拽视频到此处，或点击选择文件'}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              支持 MP4 / MOV / WebM / MKV / AVI · 最大 500MB · 30 分钟以内
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              inputRef.current?.click();
            }}
            className={cn(
              'mt-2 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium',
              'bg-primary text-primary-foreground hover:bg-primary/90 transition',
              'disabled:opacity-60 disabled:cursor-not-allowed',
            )}
            disabled={status === 'uploading' || status === 'done'}
          >
            <FileVideo className="w-4 h-4" />
            {status === 'uploading'
              ? `上传中 ${progress}%`
              : status === 'done'
                ? '处理中...'
                : '点击选择视频文件'}
          </button>

          {fileName && status !== 'done' && (
            <p className="text-xs text-muted-foreground truncate max-w-md">已选：{fileName}</p>
          )}
        </div>
      </label>

      {/* 进度条 */}
      {status === 'uploading' && (
        <div className="mt-5 h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
      )}

      {/* 错误提示 */}
      {status === 'error' && error && (
        <div className="mt-5 flex gap-3 items-start rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">上传失败</p>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {status === 'done' && (
        <div className="mt-5 flex gap-3 items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>上传成功！正在进入字幕编辑器...</span>
        </div>
      )}
    </div>
  );
}
