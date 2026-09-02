// 工具函数（cn 来自 lib/utils，但时间格式化被 VideoPlayer 引用时可能需要共享路径）
// 为了避免 VideoPlayer 中的循环依赖，这里做一个共享 barrel。
// NOTE: 你可以在 VSCode 中把 lib/utils.ts 的 cn 直接 import 到这里再 re-export，避免修改 VideoPlayer 的 import 路径。
// 这里选择直接重新 export，保持 lib/utils 作为单一源。
export { cn } from '@/lib/utils';
export { formatPlaybackTime } from '@/lib/time';
