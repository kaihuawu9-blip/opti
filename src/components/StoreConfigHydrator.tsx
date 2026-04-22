'use client';

import { useEffect } from 'react';
import { hydrateStoreConfigFromApi } from '@/lib/storeDisplayName';

/**
 * 根布局挂载后通过 GET /api/config/store（Prisma）同步门店公开配置。
 * 不依赖云端 REST；库表为空或接口失败时服务端返回 fallback，本处 catch 仅防意外解析错误。
 */
export default function StoreConfigHydrator() {
  useEffect(() => {
    void hydrateStoreConfigFromApi().catch(() => {});
  }, []);
  return null;
}
