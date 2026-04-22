'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  getSavedReceiptPrinterDevice,
  setSavedReceiptPrinterDevice,
  getPrinterCompatMode,
  setPrinterCompatMode,
} from '@/lib/receiptElectronPrint';

type PrinterRow = { name: string; displayName: string; description?: string };
type PrinterMode = 'network' | 'usb';

type PrinterConfig = {
  mode: PrinterMode;
  network: {
    ip: string;
    port: number;
  };
  usb: {
    deviceName: string;
  };
};

function isFileOnlyPrinterLabel(displayName: string, name: string): boolean {
  const t = `${displayName} ${name}`.toLowerCase();
  return (
    /pdf|onenote|xps|fax|document writer|microsoft print to pdf|导出|保存为|save as|virtual/i.test(t) ||
    /wondershare|adobe pdf|foxit/i.test(t)
  );
}

export function ReceiptDesktopPrinterBar() {
  const [mounted, setMounted] = useState(false);
  const [list, setList] = useState<PrinterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('');
  const [saved, setSavedState] = useState<string | null>(null);
  const [compatMode, setCompatModeState] = useState(false);
  const [config, setConfig] = useState<PrinterConfig>({
    mode: 'usb',
    network: {
      ip: '192.168.1.100',
      port: 9100
    },
    usb: {
      deviceName: ''
    }
  });

  // 加载配置
  useEffect(() => {
    setMounted(true);
    setSavedState(getSavedReceiptPrinterDevice());
    setCompatModeState(getPrinterCompatMode());
    
    if (typeof window !== 'undefined' && (window as any).thermalPrinter) {
      (window as any).thermalPrinter.getConfig().then((res: any) => {
        if (res?.ok) {
          setConfig(res.config);
        }
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    const fn = typeof window !== 'undefined' ? window.electronApp?.listPrinters : undefined;
    if (!fn) return;
    setLoading(true);
    try {
      const res = await fn();
      if (res?.ok && Array.isArray(res.printers)) {
        const rows = res.printers as PrinterRow[];
        const sorted = [...rows].sort((a, b) => {
          const fa = isFileOnlyPrinterLabel(a.displayName, a.name) ? 1 : 0;
          const fb = isFileOnlyPrinterLabel(b.displayName, b.name) ? 1 : 0;
          return fa - fb;
        });
        setList(sorted);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === 'undefined' || !window.electronApp?.listPrinters) return;
    void refresh();
  }, [mounted, refresh]);

  if (!mounted || typeof window === 'undefined' || !window.electronApp?.listPrinters) {
    return null;
  }

  const save = async () => {
    if (config.mode === 'usb') {
      const name = selected.trim();
      if (!name) {
        window.alert('请先在列表中选择一台小票热敏打印机（不要选 PDF / OneNote 等）。');
        return;
      }
      if (isFileOnlyPrinterLabel(list.find((p) => p.name === name)?.displayName || '', name)) {
        const ok = window.confirm('当前选中项看起来像「打印到文件」类驱动，保存后仍可能弹出另存为。确定要保存吗？');
        if (!ok) return;
      }
      
      // 保存到 localStorage（兼容旧代码）
      localStorage.setItem('selected_printer_name', name);
      setSavedReceiptPrinterDevice(name);
      setSavedState(name);
      
      // 更新配置
      const newConfig = {
        ...config,
        usb: { deviceName: name }
      };
      setConfig(newConfig);
      
      if ((window as any).thermalPrinter?.setConfig) {
        await (window as any).thermalPrinter.setConfig(newConfig);
      }
      
      // 测试打印
      try {
        if ((window as any).thermalPrinter?.testPrint) {
          await (window as any).thermalPrinter.testPrint(name);
        }
      } catch (e) {
        console.error('测试打印失败:', e);
      }
      
      window.alert('打印机配置已保存：' + name + '\n\n正在发送测试打印...');
    } else {
      // 网络模式
      if (!config.network.ip) {
        window.alert('请输入打印机 IP 地址');
        return;
      }
      
      // 保存配置
      if ((window as any).thermalPrinter?.setConfig) {
        await (window as any).thermalPrinter.setConfig(config);
      }
      
      // 测试打印
      try {
        if ((window as any).thermalPrinter?.testPrint) {
          await (window as any).thermalPrinter.testPrint(`网络打印机 ${config.network.ip}:${config.network.port}`);
        }
      } catch (e) {
        console.error('测试打印失败:', e);
      }
      
      window.alert('网络打印机配置已保存：' + config.network.ip + ':' + config.network.port + '\n\n正在发送测试打印...');
    }
  };

  const clear = () => {
    setSavedReceiptPrinterDevice(null);
    setSavedState(null);
    setSelected('');
  };

  const handleModeChange = (mode: PrinterMode) => {
    setConfig(prev => ({ ...prev, mode }));
  };

  const handleNetworkIpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig(prev => ({
      ...prev,
      network: { ...prev.network, ip: e.target.value }
    }));
  };

  const handleNetworkPortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig(prev => ({
      ...prev,
      network: { ...prev.network, port: parseInt(e.target.value) || 9100 }
    }));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-3 text-[11px] text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">桌面端小票机（ESC/POS 原始指令）</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新列表
        </button>
      </div>

      {/* 模式选择 */}
      <div className="space-y-2">
        <span className="font-medium text-slate-800">连接模式</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleModeChange('usb')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              config.mode === 'usb'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            USB 模式
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('network')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              config.mode === 'network'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            网络模式
          </button>
        </div>
      </div>

      {/* USB 模式配置 */}
      {config.mode === 'usb' && (
        <div className="space-y-2">
          <p className="text-slate-500 leading-relaxed">
            在下列表中选择<strong>真实 USB 小票机</strong>并保存后，「立即打印」会<strong>直接出纸</strong>，不会经过「Microsoft Print to
            PDF」的另存为。不保存则仍打开系统打印窗口，请勿选 PDF。
          </p>
          {saved ? (
            <p className="text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1">
              当前已指定：<span className="font-mono">{saved}</span>
            </p>
          ) : (
            <p className="text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">尚未指定小票机（将弹出系统打印对话框）</p>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="">— 选择打印机 —</option>
              {list.map((p) => (
                <option key={p.name} value={p.name}>
                  {isFileOnlyPrinterLabel(p.displayName, p.name) ? '（输出为文件）' : ''}
                  {p.displayName || p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* 网络模式配置 */}
      {config.mode === 'network' && (
        <div className="space-y-2">
          <p className="text-slate-500 leading-relaxed">
            配置网络打印机的 IP 地址和端口，然后保存。使用<strong>ESC/POS 原始指令</strong>直接打印，不依赖 Windows 驱动。
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <label className="block text-xs text-slate-600 mb-1">IP 地址</label>
              <input
                type="text"
                value={config.network.ip}
                onChange={handleNetworkIpChange}
                placeholder="192.168.1.100"
                className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-600 mb-1">端口</label>
              <input
                type="number"
                value={config.network.port}
                onChange={handleNetworkPortChange}
                placeholder="9100"
                className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* 兼容模式开关 */}
      <div className="pt-2 border-t border-slate-200">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={compatMode}
            onChange={(e) => {
              setCompatModeState(e.target.checked);
              setPrinterCompatMode(e.target.checked);
            }}
            className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
          />
          <span className="text-xs font-medium text-slate-800">兼容模式（老旧设备专用）</span>
        </label>
        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
          开启后使用 ESC/POS 纯文本打印，无视老旧打印机专用（如 XP-80C）。关闭后使用标准高清打印。
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-900"
        >
          保存配置
        </button>
        {config.mode === 'usb' && (
          <button
            type="button"
            onClick={clear}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            清除
          </button>
        )}
      </div>
    </div>
  );
}
