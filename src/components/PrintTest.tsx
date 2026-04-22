'use client';

import { Printer } from 'lucide-react';

type ElectronPrintAPI = {
  getPrinters?: () => Promise<unknown[]>;
  print?: (payload: { htmlContent: string; printerName?: string }) => Promise<{ status?: string } | undefined>;
};

export function PrintTest() {
  const handlePrint = async () => {
    try {
      const electronAPI =
        typeof window !== 'undefined' ? (window as unknown as { electronAPI?: ElectronPrintAPI }).electronAPI : undefined;
      const printers = await electronAPI?.getPrinters?.();
      console.log('可用打印机:', printers);

      const result = await electronAPI?.print?.({
        htmlContent: `
          <html>
            <body style="font-family: sans-serif; padding: 20px;">
              <h1 style="color: red;">打印测试单</h1>
              <p>来自 Next.js + Electron 的打印请求</p>
              <p>时间: ${new Date().toLocaleString()}</p>
            </body>
          </html>
        `,
        printerName: '',
      });

      if (result?.status === 'success') {
        window.alert('打印指令已发出！');
      }
    } catch (error) {
      console.error('打印失败:', error);
      window.alert('打印失败，请检查控制台原因');
    }
  };

  const electronAPI =
    typeof window !== 'undefined' ? (window as unknown as { electronAPI?: ElectronPrintAPI }).electronAPI : undefined;
  if (!electronAPI) {
    return null;
  }

  return (
    <div className="flex gap-3 flex-wrap">
      <button
        type="button"
        onClick={handlePrint}
        className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-all flex items-center gap-2"
      >
        <Printer className="w-4 h-4" />
        <span>打印</span>
      </button>
    </div>
  );
}
