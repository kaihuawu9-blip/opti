export {};

declare global {
  interface Window {
    electronAI?: {
      chat: (payload: {
        message: string;
        userTag?: string;
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        mode?: 'free' | 'business';
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      }) => Promise<{ ok: boolean; answer?: string; error?: string }>;
      chatStream: (
        payload: {
          message: string;
          userTag?: string;
          apiKey?: string;
          baseUrl?: string;
          model?: string;
          mode?: 'free' | 'business';
          history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        },
        onEvent: (event: { requestId: string; delta?: string; done?: boolean; error?: string }) => void,
      ) => string;
    };
    electronApp?: {
      /** 存在即表示运行在 Electron 壳内 */
      isDesktop?: boolean;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      openPlatformWindow: (payload: {
        key: string;
        title: string;
        url: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      listPrinters: () => Promise<{
        ok: boolean;
        error?: string;
        printers?: Array<{ name: string; displayName: string; description?: string }>;
      }>;
      printSilent: (payload?: {
        silent?: boolean;
        printBackground?: boolean;
        deviceName?: string;
      }) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
