import { APP_NAME, DEFAULT_STORE_DISPLAY_FALLBACK } from '@/lib/constants';

/** 与 GET /api/config/store 返回体一致；供 Hydrator 与模块缓存使用 */
export type StoreConfigPublicPayload = {
  ok: true;
  source: 'fallback' | 'database';
  appName: string;
  defaultStoreDisplayName: string;
  supportUrl: string;
  domain: string;
  supportHost: string;
  ui: {
    dashboardPath: string;
    cashierPath: string;
    inventoryPath: string;
    packagesPath: string;
    reportsPath: string;
    reconciliationPath: string;
  };
  calibration: {
    defaultPxPerMm: number;
    minPxPerMm: number;
    maxPxPerMm: number;
  };
  /** 门店配置的 AI 助手显示名（store_config.agent_custom_name） */
  agentCustomName?: string | null;
};

export const STORE_CONFIG_PUBLIC_FALLBACK: StoreConfigPublicPayload = {
  ok: true,
  source: 'fallback',
  appName: APP_NAME,
  defaultStoreDisplayName: DEFAULT_STORE_DISPLAY_FALLBACK,
  supportUrl: 'https://opti-ai.cn',
  domain: 'opti-ai.cn',
  supportHost: 'opti-ai.cn',
  ui: {
    dashboardPath: '/dashboard/',
    cashierPath: '/cashier/',
    inventoryPath: '/inventory/',
    packagesPath: '/packages/',
    reportsPath: '/reports/',
    reconciliationPath: '/reconciliation/',
  },
  calibration: {
    defaultPxPerMm: 4,
    minPxPerMm: 1,
    maxPxPerMm: 20,
  },
};
