'use client';

import { QueryClient, QueryClientProvider, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * TanStack Query 客户端 Provider
 * - 客户端全局单例（服务端不共享）
 * - 合理的 staleTime / gcTime，减少网络请求
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 分钟内不重新请求
        refetchOnWindowFocus: false, // 避免频繁刷新
        retry: (failureCount, error: any) => {
          // 仅 5xx / 网络错误重试 1 次，4xx 直接失败
          if (failureCount >= 1) return false;
          const status = error?.status ?? error?.response?.status;
          return typeof status === 'number' ? status >= 500 : true;
        },
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  // useState 保证 SSR 和客户端只初始化一次
  const [client] = useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
