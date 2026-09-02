// apps/web/src/types/plyr.d.ts
// Plyr 本身未发布官方 @types/plyr，这里提供最小可运行类型声明，覆盖 V1 使用场景。
declare module 'plyr' {
  type PlyrEventType =
    | 'ready'
    | 'play'
    | 'pause'
    | 'timeupdate'
    | 'seeked'
    | 'ended'
    | 'volumechange'
    | 'ratechange';

  interface PlyrSource {
    type?: 'video' | 'audio';
    title?: string;
    sources: Array<{
      src: string;
      type?: string;
      size?: number;
    }>;
    poster?: string;
    tracks?: Array<Record<string, unknown>>;
  }

  type PlyrListener = (this: Plyr, event: Event) => void;

  export default class Plyr {
    constructor(target: HTMLMediaElement | string | Element, options?: Record<string, unknown>);

    static setup(targets: HTMLElement | HTMLElement[] | NodeList | string, options?: Record<string, unknown>): Plyr[];

    /** 当前播放位置（秒，支持小数） */
    currentTime: number;
    /** 视频/音频总时长（秒） */
    readonly duration: number;
    /** 是否正在播放 */
    readonly playing: boolean;
    /** 是否暂停 */
    readonly paused: boolean;
    /** 是否已加载 */
    readonly ready: boolean;
    /** 播放速率 0.25 - 4 */
    playbackRate: number;
    /** 音量 0 - 1 */
    volume: number;
    /** 静音 */
    muted: boolean;

    /** 开始播放，浏览器用户未交互时返回的 Promise 可能 reject */
    play(): Promise<void>;
    /** 暂停 */
    pause(): void;
    /** 停止并回到 0 秒 */
    stop(): void;
    /** 跳转到指定秒数 */
    seek(time: number): void;
    /** 销毁实例 */
    destroy(): void;
    /** 重置到初始状态 */
    restart(): void;

    /** 切换播放/暂停 */
    togglePlay(toggle?: boolean): void;
    /** 切换静音 */
    toggleMute(toggle?: boolean): void;
    /** 切换全屏 */
    toggleCaptions(toggle?: boolean): void;
    /** 切换画中画 */
    togglePiP(toggle?: boolean): boolean;
    /** 切换全屏 */
    toggleFullscreen(toggle?: boolean): void;

    /** 设置视频源 */
    source(source: PlyrSource): void;

    /** 监听事件 */
    on(event: PlyrEventType | string, listener: PlyrListener): this;
    /** 一次性监听 */
    once(event: PlyrEventType | string, listener: PlyrListener): this;
    /** 移除监听 */
    off(event: PlyrEventType | string, listener: PlyrListener): this;
    /** 触发事件 */
    emit(event: PlyrEventType | string, detail?: unknown): boolean;

    /** 支持的特性集（只读，占位） */
    readonly supported: { api: boolean; ui: boolean };
  }
}
