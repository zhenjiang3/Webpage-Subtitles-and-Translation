/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    '@prisma/client',
    // 方案 A 免费零 API：@xenova/transformers 需要跑 ONNX Runtime（原生 .node 模块 + 读写模型缓存）
    // 必须 external，否则 Next server bundle 会把它们打包进 RSC payload → 找不到原生 .node 文件
    '@xenova/transformers',
    'onnxruntime-node',
  ],
  images: {
    remotePatterns: [],
  },
  // 视频/字幕文件通过 API 路由流式提供，不走 public
  transpilePackages: ['lucide-react'],
  // V1 在提交阶段单独跑 typecheck/lint，build 过程保持纯构建
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  poweredByHeader: false,
};

export default nextConfig;
