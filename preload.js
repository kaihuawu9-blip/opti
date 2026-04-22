/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAI', {
  chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  chatStream: (payload, onEvent) => {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const listener = (_event, msg) => {
      if (!msg || msg.requestId !== requestId) return;
      onEvent(msg);
      if (msg.done || msg.error) {
        ipcRenderer.removeListener('ai:stream', listener);
      }
    };
    ipcRenderer.on('ai:stream', listener);
    ipcRenderer.send('ai:chat-stream', { requestId, payload });
    return requestId;
  },
});

contextBridge.exposeInMainWorld('electronApp', {
  /** 供前端识别桌面壳，避免仅依赖 location.protocol 时漏判 */
  isDesktop: true,
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openPlatformWindow: (payload) => ipcRenderer.invoke('app:openPlatformWindow', payload),
  listPrinters: () => ipcRenderer.invoke('app:listPrinters'),
  executePrint: (payload) => ipcRenderer.invoke('execute-print', payload || {}),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  print: (data) => ipcRenderer.invoke('execute-print', data),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  forceTestPrint: () => ipcRenderer.invoke('force-test-print'),
  glassOrderPrintTest: (order) => ipcRenderer.invoke('glass-order-print-test', order),
});

// 新的 ThermalPrinter API
contextBridge.exposeInMainWorld('thermalPrinter', {
  getConfig: () => ipcRenderer.invoke('thermal:getConfig'),
  setConfig: (config) => ipcRenderer.invoke('thermal:setConfig', config),
  print: (data) => ipcRenderer.invoke('thermal:print', data),
  testPrint: (printerName) => ipcRenderer.invoke('thermal:testPrint', { printerName }),
});
