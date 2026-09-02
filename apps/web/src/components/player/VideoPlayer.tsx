'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { cn, formatPlaybackTime } from '@/lib/utils-shared';
import type { SubtitleCue } from '@/lib/types';

interface Props {
  videoUrl: string;
  className?: string;
  currentCueIndex?: number;
  onTimeUpdate?: (timeMs: number) => void;
  onSeeked?: (timeMs: number) => void;
  plyrRef?: (plyr: Plyr | null) => void;
}

/**
 * Plyr 封装 — V1 字幕编辑器的播放器核心组件
 * TODO：字幕轨道切换（导出 SRT 作为 data URL 注入 track）
 */
export function VideoPlayer({
  videoUrl,
  className,
  currentCueIndex,
  onTimeUpdate,
  onSeeked,
  plyrRef,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const currentCueRef = useRef(currentCueIndex);
  currentCueRef.current = currentCueIndex;

  useEffect(() => {
    if (!videoRef.current) return;
    const player = new Plyr(videoRef.current, {
      controls: [
        'play-large',
        'play',
        'progress',
        'current-time',
        'duration',
        'mute',
        'volume',
        'captions',
        'settings',
        'pip',
        'airplay',
        'fullscreen',
      ],
      settings: ['captions', 'quality', 'speed'],
      seekTime: 5,
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      keyboard: { focused: true, global: true },
      i18n: { restart: '重新播放', rewind: '后退 {seektime}s', play: '播放' },
    });
    playerRef.current = player;
    plyrRef?.(player);

    let lastSeekReported = -1;
    const onT = () => {
      const ms = Math.round(player.currentTime * 1000);
      onTimeUpdate?.(ms);
    };
    const onS = () => {
      const ms = Math.round(player.currentTime * 1000);
      if (Math.abs(ms - lastSeekReported) > 150) {
        lastSeekReported = ms;
        onSeeked?.(ms);
      }
    };

    player.on('timeupdate', onT);
    player.on('seeked', onS);

    return () => {
      player.off('timeupdate', onT);
      player.off('seeked', onS);
      player.destroy();
      playerRef.current = null;
      plyrRef?.(null);
    };
    // 只在 videoUrl 变化时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  return (
    <div className={cn('rounded-xl overflow-hidden border bg-black aspect-video', className)}>
      <video
        ref={videoRef}
        playsInline
        controls
        crossOrigin="anonymous"
        className="w-full h-full"
      >
        <source src={videoUrl} />
        您的浏览器不支持 HTML5 video。
      </video>
    </div>
  );
}

/** 工具：根据当前时间找当前 cue index（二分） */
export function findActiveCueIndex(cues: SubtitleCue[], currentMs: number): number {
  if (!cues.length) return -1;
  let l = 0;
  let r = cues.length - 1;
  let ans = -1;
  while (l <= r) {
    const mid = (l + r) >> 1;
    const c = cues[mid];
    if (currentMs >= c.startMs && currentMs <= c.endMs) {
      ans = mid;
      break;
    } else if (currentMs < c.startMs) {
      r = mid - 1;
    } else {
      ans = mid; // 可能在两条之间，显示最近已过的
      l = mid + 1;
    }
  }
  return ans;
}

// 防止循环导入：这里直接内联导出时间格式化（lib/time.ts 已定义，此处是备选）
export { formatPlaybackTime };
