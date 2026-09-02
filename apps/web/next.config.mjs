/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@prisma/client'],
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
