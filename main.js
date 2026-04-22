/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, protocol, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const platformWindows = new Map();

// ==================== GlassOrderPrinter - 眼镜店验光单专用打印机 ====================
class GlassOrderPrinter {
  constructor() {
    this.esc = '\x1B';
    this.gs = '\x1D';
    this.init = this.esc + '@';
    this.reset = this.esc + '!' + '\x00';
    this.boldOn = this.esc + 'E' + '\x01';
    this.boldOff = this.esc + 'E' + '\x00';
    this.doubleWidth = this.esc + '!' + '\x20';
    this.centerAlign = this.esc + 'a' + '\x01';
    this.leftAlign = this.esc + 'a' + '\x00';
    this.cut = this.gs + 'V' + '\x41' + '\x00';
    this.feed = '\n';
  }

  text(v) {
    const s = String(v ?? '').trim();
    return s || '-';
  }

  toMoney(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  }

  lineTotal(item) {
    const explicit = Number(item.line_total ?? item.lineTotal);
    if (Number.isFinite(explicit)) return explicit;
    const qty = Number(item.quantity ?? 0);
    const unit = Number(item.unit_price ?? item.unitPrice ?? 0);
    return Number.isFinite(qty * unit) ? qty * unit : 0;
  }

  padLeft(str, len) {
    const s = this.text(str);
    const spaces = Math.max(0, len - s.length);
    return ' '.repeat(spaces) + s;
  }

  padRight(str, len) {
    const s = this.text(str);
    const spaces = Math.max(0, len - s.length);
    return s + ' '.repeat(spaces);
  }

  normalizeMethodLabel(raw) {
    const m = raw.toLowerCase();
    if (m.includes('meituan') || m.includes('美团') || m.includes('douyin') || m.includes('抖音')) return '美团/抖音';
    if (m.includes('wechat') || m.includes('微信')) return '微信支付';
    if (m.includes('alipay') || m.includes('支付宝')) return '支付宝支付';
    if (m.includes('cash') || m.includes('现金')) return '现金';
    return this.text(raw);
  }

  axisCell(v) {
    return this.text(v).replace(/°+$/g, '');
  }

  generateESC_POS(order) {
    const orderNo = this.text(order.order_no ?? order.orderNo);
    const storeName = this.text(order.store_name ?? order.storeName);
    const createdAt = this.text(order.created_at ?? order.createdAt);
    const customerName = this.text(order.customer_name ?? order.customerName);
    const customerPhone = this.text(order.customer_phone ?? order.customerPhone);
    const paymentRaw = this.text(order.payment_method ?? order.paymentMethod ?? 'cash');
    const paymentLabel = this.normalizeMethodLabel(paymentRaw);
    const hasMeituan = /(meituan|美团|douyin|抖音)/i.test(paymentRaw);
    const hasWechat = /(wechat|微信)/i.test(paymentRaw);
    const voucher = this.text(order.meituan_voucher ?? order.meituanVoucher);
    const paymentNote = this.text(order.payment_note ?? order.paymentNote);
    const items = order.items ?? [];
    const total = order.total_amount ?? order.totalAmount ?? items.reduce((sum, it) => sum + this.lineTotal(it), 0);

    const orderRx = order.rx ?? items.find((it) => Boolean(it.rx?.right || it.rx?.left))?.rx ?? null;
    const right = orderRx?.right ?? {};
    const left = orderRx?.left ?? {};

    let output = '';

    output += this.init;
    output += this.reset;
    output += this.feed;

    output += this.centerAlign;
    output += this.doubleWidth;
    output += this.boldOn;
    output += storeName + this.feed;
    output += this.boldOff;
    output += this.reset;
    output += '验光配镜销售单' + this.feed;
    output += this.feed;

    output += this.leftAlign;
    output += '订单号: ' + orderNo + this.feed;
    output += '时间: ' + createdAt + this.feed;
    output += '客户: ' + customerName + this.feed;
    output += '电话: ' + customerPhone + this.feed;
    output += this.feed;

    output += '================================' + this.feed;
    output += this.centerAlign;
    output += '专业验光表' + this.feed;
    output += this.leftAlign;
    output += '--------------------------------' + this.feed;
    output += '验光项目      右眼(OD)   左眼(OS)' + this.feed;
    output += '--------------------------------' + this.feed;
    output += '球镜(SPH): ' + this.padLeft(right.ds, 8) + '  ' + this.padLeft(left.ds, 8) + this.feed;
    output += '散光(CYL): ' + this.padLeft(right.dc, 8) + '  ' + this.padLeft(left.dc, 8) + this.feed;
    output += '轴位(AXIS):' + this.padLeft(this.axisCell(right.axis), 8) + '  ' + this.padLeft(this.axisCell(left.axis), 8) + this.feed;
    output += '瞳距(PD):  ' + this.padLeft(right.pd, 8) + '  ' + this.padLeft(left.pd, 8) + this.feed;
    output += '下加(ADD): ' + this.padLeft(right.add, 8) + '  ' + this.padLeft(left.add, 8) + this.feed;
    output += '================================' + this.feed;
    output += this.feed;

    output += '商品明细:' + this.feed;
    output += '--------------------------------' + this.feed;
    output += this.padRight('商品', 16) + ' ' + this.padLeft('单价', 6) + ' ' + this.padLeft('数量', 4) + ' ' + this.padLeft('小计', 8) + this.feed;
    output += '--------------------------------' + this.feed;

    for (const item of items) {
      const name = this.text(item.name);
      const unit = Number(item.unit_price ?? item.unitPrice ?? 0);
      const qty = Number(item.quantity ?? 0);
      const subtotal = this.lineTotal(item);

      const displayName = name.length > 14 ? name.substring(0, 14) + '..' : name;
      output += this.padRight(displayName, 16) + ' ';
      output += this.padLeft(this.toMoney(unit), 6) + ' ';
      output += this.padLeft(String(Number.isFinite(qty) ? qty : 0), 4) + ' ';
      output += this.padLeft(this.toMoney(subtotal), 8) + this.feed;
    }

    output += '--------------------------------' + this.feed;
    output += this.feed;

    output += '【结算区】' + this.feed;
    output += '支付方式: ' + paymentLabel + this.feed;
    output += this.boldOn;
    output += '应收合计: ￥' + this.toMoney(total) + this.feed;
    output += this.boldOff;

    if (hasMeituan && voucher && voucher !== '-') {
      output += '【美团团购券号】' + voucher + this.feed;
    }
    if (hasWechat && paymentNote && paymentNote !== '-') {
      output += '微信备注: ' + paymentNote + this.feed;
    }

    output += this.feed;
    output += '--------------------------------' + this.feed;
    output += this.centerAlign;
    output += this.boldOn;
    output += '凭此单据取镜' + this.feed;
    output += this.boldOff;
    output += '温馨提示: 建议半年复查视力' + this.feed;
    output += this.leftAlign;

    output += this.feed;
    output += this.feed;
    output += this.feed;
    output += this.feed;
    output += this.feed;

    output += this.cut;

    return output;
  }
}

const glassPrinter = new GlassOrderPrinter();

// ==================== 通用 ThermalPrinter 服务 ====================
class ThermalPrinterService {
  constructor() {
    this.config = {
      mode: 'network', // 'network' 或 'usb'
      network: {
        ip: '192.168.1.100',
        port: 9100
      },
      usb: {
        deviceName: 'XP-80C'
      }
    };
    this.loadConfig();
  }

  loadConfig() {
    try {
      const configPath = path.join(app.getPath('userData'), 'printer-config.json');
      if (fs.existsSync(configPath)) {
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.config = { ...this.config, ...saved };
      }
    } catch (e) {
      console.warn('加载打印机配置失败:', e);
    }
  }

  saveConfig() {
    try {
      const configPath = path.join(app.getPath('userData'), 'printer-config.json');
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      console.error('保存打印机配置失败:', e);
    }
  }

  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
  }

  getConfig() {
    return this.config;
  }

  // 生成 ESC/POS 原始指令
  generateEscPosCommands(data) {
    const buffer = [];

    // 初始化打印机
    buffer.push(0x1B, 0x40); // ESC @

    // 居中、加粗、双倍大小打印店名
    if (data.storeName) {
      buffer.push(0x1B, 0x61, 0x01); // ESC a 1 (居中)
      buffer.push(0x1B, 0x21, 0x30); // ESC ! 0x30 (加粗+双倍宽高)
      buffer.push(...Buffer.from(data.storeName, 'gbk'));
      buffer.push(0x0A); // LF
    }

    // 恢复正常
    buffer.push(0x1B, 0x21, 0x00); // ESC ! 0x00 (正常)
    buffer.push(0x1B, 0x61, 0x00); // ESC a 0 (左对齐)

    // 分隔线
    buffer.push(...Buffer.from('--------------------------------', 'gbk'));
    buffer.push(0x0A);

    // 订单信息
    buffer.push(...Buffer.from(`单据号: ${data.orderNo}`, 'gbk'));
    buffer.push(0x0A);
    buffer.push(...Buffer.from(`客人: ${data.customerName} (${data.customerPhone})`, 'gbk'));
    buffer.push(0x0A);
    buffer.push(...Buffer.from(`支付方式: ${data.paymentMethod}`, 'gbk'));
    buffer.push(0x0A);
    buffer.push(...Buffer.from(`时间: ${new Date(data.createdAt).toLocaleString()}`, 'gbk'));
    buffer.push(0x0A);

    // 分隔线
    buffer.push(...Buffer.from('--------------------------------', 'gbk'));
    buffer.push(0x0A);

    // 商品明细
    data.items.forEach(item => {
      buffer.push(...Buffer.from(`${item.name} x${item.quantity}`, 'gbk'));
      buffer.push(0x0A);
      buffer.push(...Buffer.from(`  单价: ¥${item.unitPrice.toFixed(2)}  小计: ¥${item.lineTotal.toFixed(2)}`, 'gbk'));
      buffer.push(0x0A);
    });

    // 分隔线
    buffer.push(...Buffer.from('--------------------------------', 'gbk'));
    buffer.push(0x0A);

    // 总计（居中、加粗、双倍大小）
    buffer.push(0x1B, 0x61, 0x01); // 居中
    buffer.push(0x1B, 0x21, 0x30); // 加粗+双倍
    buffer.push(...Buffer.from(`总计: ¥${data.totalAmount.toFixed(2)}`, 'gbk'));
    buffer.push(0x0A);

    // 恢复正常
    buffer.push(0x1B, 0x21, 0x00);
    buffer.push(0x1B, 0x61, 0x00);

    // 空行
    buffer.push(0x0A, 0x0A, 0x0A);

    // 切纸
    buffer.push(0x1D, 0x56, 0x41, 0x00); // GS V 65 0 (部分切纸)

    return Buffer.from(buffer);
  }

  // 生成测试打印指令
  generateTestPrint(printerName) {
    const buffer = [];
    buffer.push(0x1B, 0x40); // 初始化
    buffer.push(0x1B, 0x61, 0x01); // 居中
    buffer.push(0x1B, 0x21, 0x30); // 加粗+双倍
    buffer.push(...Buffer.from('打印机配置成功', 'gbk'));
    buffer.push(0x0A);
    buffer.push(0x1B, 0x21, 0x00); // 恢复正常
    buffer.push(0x0A);
    buffer.push(...Buffer.from(`打印机名称: ${printerName}`, 'gbk'));
    buffer.push(0x0A);
    buffer.push(...Buffer.from(`测试时间: ${new Date().toLocaleString()}`, 'gbk'));
    buffer.push(0x0A, 0x0A, 0x0A);
    buffer.push(0x1D, 0x56, 0x41, 0x00); // 切纸
    return Buffer.from(buffer);
  }

  // 网络打印
  async printNetwork(commands) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);

      socket.connect(this.config.network.port, this.config.network.ip, () => {
        console.log(`连接到网络打印机: ${this.config.network.ip}:${this.config.network.port}`);
        socket.write(commands, () => {
          socket.end();
          resolve({ ok: true, status: 'success' });
        });
      });

      socket.on('error', (err) => {
        console.error('网络打印错误:', err);
        reject(err);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('连接超时'));
      });
    });
  }

  // USB 打印 - 使用系统命令
  async printUSB(commands, printerName) {
    console.log('使用 USB 模式打印（通过系统命令）');
    
    // 方法 1: 写入临时文件，然后用 copy /b 发送到 LPT1 或 USB 端口
    const tempBinPath = path.join(app.getPath('temp'), 'print_job.bin');
    fs.writeFileSync(tempBinPath, commands);
    
    try {
      // 尝试用 copy /b 发送到常见的打印机端口
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const ports = ['LPT1:', 'LPT2:', 'LPT3:', 'COM1:', 'COM2:'];
      let printSuccess = false;
      
      for (const port of ports) {
        try {
          console.log(`尝试发送到端口 ${port}...`);
          await execPromise(`copy /b "${tempBinPath}" ${port}`);
          console.log(`成功发送到 ${port}`);
          printSuccess = true;
          break;
        } catch (e) {
          console.warn(`端口 ${port} 失败:`, e.message);
        }
      }
      
      // 如果端口方式失败，回退到 webContents.print (保持兼容)
      if (!printSuccess) {
        console.log('回退到 webContents.print 方式...');
        const win = new BrowserWindow({ show: false });
        
        // 生成简单的纯文本 HTML
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
              @page { size: 80mm auto; margin: 0; }
              body { width: 80mm; margin: 0; padding: 0 4mm; font-size: 14px; line-height: 1.5; font-family: monospace; }
            </style>
          </head>
          <body>
            <pre>${commands.toString('latin1').replace(/\0/g, '')}</pre>
          </body>
          </html>
        `;
        
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        
        const pdfData = await win.webContents.printToPDF({
          pageSize: { width: 3.15, height: 11.7 },
          margins: { top: 0, bottom: 0, left: 0, right: 0 }
        });
        
        const tempPdfPath = path.join(app.getPath('temp'), 'temp_usb_receipt.pdf');
        fs.writeFileSync(tempPdfPath, pdfData);
        
        const { print } = require('pdf-to-printer');
        await print(tempPdfPath, { printer: printerName || this.config.usb.deviceName });
        
        win.destroy();
        
        try {
          fs.unlinkSync(tempPdfPath);
        } catch (e) {
          console.warn('清理 PDF 临时文件失败:', e);
        }
      }
      
      return { ok: true, status: 'success' };
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(tempBinPath);
      } catch (e) {
        console.warn('清理二进制临时文件失败:', e);
      }
    }
  }

  // 主打印方法
  async print(data, isTest = false) {
    let commands;
    if (isTest) {
      commands = this.generateTestPrint(data.printerName || this.config.usb.deviceName);
    } else {
      commands = this.generateEscPosCommands(data);
    }

    if (this.config.mode === 'network') {
      return await this.printNetwork(commands);
    } else {
      return await this.printUSB(commands, data.printerName);
    }
  }
}

// 初始化打印机服务
const printerService = new ThermalPrinterService();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

ipcMain.handle('ai:chat', async (_event, payload) => {
  try {
    const body = payload || {};
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const userTag = String(body.userTag || '').trim();
    const mode = body.mode === 'business' ? 'business' : 'free';
    if (!message) return { ok: false, error: 'message 不能为空' };

    const apiKey = String(body.apiKey || process.env.OPENAI_API_KEY || '').trim();
    const baseUrl = String(body.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
    const model = String(body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    if (!apiKey) {
      return { ok: false, error: '桌面端未配置 OPENAI_API_KEY' };
    }

    const systemPrompt =
      mode === 'business'
        ? '你是「镜售」内置 AI 助手（门店模式）。只回答与门店经营相关问题：下单、验光、库存、门店、售后、报表。非相关问题请礼貌拒答并引导回业务话题。'
        : '你是一个通用 AI 助手（自由模式）。直接回答用户问题，不主动引导到眼镜门店业务，不额外加入行业话术。';

    const messages = [
      { role: 'system', content: systemPrompt + (userTag ? ` 当前用户标识: ${userTag}` : '') },
      ...history.slice(-10),
      { role: 'user', content: message },
    ];

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, temperature: 0.4, messages }),
    });

    const raw = await resp.text();
    if (!resp.ok) return { ok: false, error: `上游模型接口失败: ${raw}` };
    const data = raw ? JSON.parse(raw) : {};
    const answer = data?.choices?.[0]?.message?.content?.trim() || '抱歉，我暂时无法回答，请稍后再试。';
    return { ok: true, answer };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return { ok: false, error: msg };
  }
});

ipcMain.on('ai:chat-stream', async (event, body) => {
  const requestId = String(body?.requestId || '').trim();
  const payload = body?.payload || {};
  const send = (msg) => {
    event.sender.send('ai:stream', { requestId, ...msg });
  };
  try {
    const message = String(payload.message || '').trim();
    const history = Array.isArray(payload.history) ? payload.history : [];
    const userTag = String(payload.userTag || '').trim();
    const mode = payload.mode === 'business' ? 'business' : 'free';
    if (!requestId) return;
    if (!message) {
      send({ error: 'message 不能为空', done: true });
      return;
    }

    const apiKey = String(payload.apiKey || process.env.OPENAI_API_KEY || '').trim();
    const baseUrl = String(payload.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
    const model = String(payload.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    if (!apiKey) {
      send({ error: '桌面端未配置 OPENAI_API_KEY', done: true });
      return;
    }

    const systemPrompt =
      mode === 'business'
        ? '你是「镜售」门店 AI 助手（门店模式）。仅回答下单、验光、库存、售后、报表。'
        : '你是通用 AI 助手（自由模式）。直接回答问题。';

    const messages = [
      { role: 'system', content: systemPrompt + (userTag ? ` 当前用户标识: ${userTag}` : '') },
      ...history.slice(-6),
      { role: 'user', content: message },
    ];

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        stream: true,
        max_tokens: 700,
        messages,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      send({ error: `上游模型接口失败: ${errText}`, done: true });
      return;
    }

    if (!resp.body) {
      send({ error: '上游未返回可读取流', done: true });
      return;
    }

    const decoder = new TextDecoder();
    const reader = resp.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const dataPart = line.slice(5).trim();
        if (dataPart === '[DONE]') {
          send({ done: true });
          return;
        }
        try {
          const json = JSON.parse(dataPart);
          const delta = json?.choices?.[0]?.delta?.content || '';
          if (delta) send({ delta });
        } catch {
          // ignore malformed chunk
        }
      }
    }

    send({ done: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    send({ error: msg, done: true });
  }
});

ipcMain.handle('app:openExternal', async (_event, url) => {
  try {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return { ok: false, error: '仅支持 http/https 链接' };
    await shell.openExternal(target);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('app:openPlatformWindow', async (_event, payload) => {
  try {
    const body = payload || {};
    const target = String(body.url || '').trim();
    const key = String(body.key || new URL(target).hostname || 'platform').trim();
    if (!/^https?:\/\//i.test(target)) return { ok: false, error: '仅支持 http/https 链接' };

    const existing = platformWindows.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      if (existing.webContents.getURL() !== target) {
        await existing.loadURL(target);
      }
      return { ok: true };
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      title: String(body.title || '线上运营'),
      icon: getWindowIconPath(),
      autoHideMenuBar: true,
      webPreferences: {
        partition: `persist:${key}`,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });
    platformWindows.set(key, win);
    win.on('closed', () => {
      platformWindows.delete(key);
    });
    await win.loadURL(target);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('app:listPrinters', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: '当前窗口不可用', printers: [] };
    const printers = await win.webContents.getPrintersAsync();
    console.log("系统可用打印机列表：", printers.map(p => p.name));
    return {
      ok: true,
      printers: printers.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description || '',
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return { ok: false, error: msg, printers: [] };
  }
});

// ==================== 打印机服务 IPC 通道 ====================

// 获取打印机配置
ipcMain.handle('thermal:getConfig', async () => {
  return { ok: true, config: printerService.getConfig() };
});

// 设置打印机配置
ipcMain.handle('thermal:setConfig', async (_event, newConfig) => {
  printerService.setConfig(newConfig);
  return { ok: true, config: printerService.getConfig() };
});

// ESC/POS 打印（新接口）
ipcMain.handle('thermal:print', async (_event, data) => {
  try {
    const result = await printerService.print(data, false);
    return { ok: true, ...result };
  } catch (e) {
    console.error('ESC/POS 打印异常:', e);
    return { ok: false, error: e instanceof Error ? e.message : '未知错误' };
  }
});

// 测试打印
ipcMain.handle('thermal:testPrint', async (_event, { printerName }) => {
  console.log('--- PRINT START ---');
  console.log('[IPC] thermal:testPrint');
  try {
    const result = await printerService.print({ printerName }, true);
    return { ok: true, ...result };
  } catch (e) {
    console.error('测试打印异常:', e);
    return { ok: false, error: e instanceof Error ? e.message : '未知错误' };
  }
});

// 主打印接口 - 暴力模式！直接打印，不管什么情况！
ipcMain.handle('execute-print', async (_event, payload) => {
  console.log('--- PRINT START ---');
  console.log('[IPC] execute-print');
  console.log('🚨 信号已收到！execute-print 被调用！');
  console.log('===== 🚀 暴力打印模式启动 =====');
  console.log('【强制】不管什么情况，直接打印！');
  
  const body = payload || {};
  const preferredPrinterName =
    String(body.deviceName || body.printerName || body?.order?.printerName || '').trim() || 'XP-80C';
  console.log('【强制】使用打印机:', preferredPrinterName);
  
  try {
    const htmlContent = typeof body.htmlContent === 'string' ? body.htmlContent : '';
    const order = body.order || {};
    const customerName = String(order.customer_name || order.customerName || '客户').trim();
    const createdAt = String(order.created_at || order.createdAt || new Date().toLocaleString()).trim();
    const technician = String(order.technician || '系统').trim();
    const right = order?.rx?.right || order?.items?.find?.((x) => x?.rx?.right)?.rx?.right || {};
    const left = order?.rx?.left || order?.items?.find?.((x) => x?.rx?.left)?.rx?.left || {};
    const pdValue = String(right.pd || left.pd || '').trim();
    const fallbackHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    /* 基础重置，确保小票不会留白边 */
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Microsoft YaHei", sans-serif; }

    /* 80mm 纸张宽度适配（实际打印区域约 72mm） */
    body { width: 72mm; padding: 2mm; color: #000; background: #fff; }

    /* 顶部店名排版 */
    .header { text-align: center; margin-bottom: 5mm; }
    .shop-name { font-size: 22px; font-weight: bold; display: block; letter-spacing: 1px; }
    .title { font-size: 14px; border: 1px solid #000; padding: 2px 10px; display: inline-block; margin-top: 5px; }

    /* 客户基本信息 */
    .info-group { font-size: 13px; margin-bottom: 4mm; line-height: 1.6; }
    .divider { border-top: 1px dashed #000; margin: 3mm 0; }

    /* 核心验光数据表：左右眼对齐是关键 */
    table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: center; }
    th { border-bottom: 1.5px solid #000; padding: 4px 0; font-size: 12px; }
    td { padding: 8px 0; font-weight: bold; }
    .eye-label { text-align: left; font-weight: normal; font-size: 13px; width: 15%; }

    /* 突出瞳距展示 */
    .pd-container {
      background: #f4f4f4;
      border: 1px solid #ddd;
      border-radius: 4px;
      text-align: center;
      padding: 10px 0;
      margin: 5mm 0;
    }
    .pd-label { font-size: 14px; color: #333; margin-bottom: 2px; }
    .pd-value { font-size: 28px; font-weight: bold; color: #000; }
    .pd-unit { font-size: 14px; margin-left: 2px; }

    /* 底部声明 */
    .footer { font-size: 12px; text-align: left; margin-top: 5mm; line-height: 1.5; color: #444; }
    .signature { text-align: right; margin-top: 10px; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <span class="shop-name">智慧眼镜管理中心</span>
    <span class="title">电脑验光报告单</span>
  </div>

  <div class="info-group">
    <div>客户姓名：${customerName || '-'}</div>
    <div>验光日期：${createdAt || '-'}</div>
    <div>验光师：${technician || '-'}</div>
    <div class="divider"></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>眼别</th>
        <th>球镜(S)</th>
        <th>柱镜(C)</th>
        <th>轴位(A)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="eye-label">右 R</td>
        <td>${String(right.ds || '').trim() || '-'}</td>
        <td>${String(right.dc || '').trim() || '-'}</td>
        <td>${String(right.axis || '').trim() || '-'}</td>
      </tr>
      <tr>
        <td class="eye-label">左 L</td>
        <td>${String(left.ds || '').trim() || '-'}</td>
        <td>${String(left.dc || '').trim() || '-'}</td>
        <td>${String(left.axis || '').trim() || '-'}</td>
      </tr>
    </tbody>
  </table>

  <div class="pd-container">
    <div class="pd-label">瞳距 (PD)</div>
    <div class="pd-value">${pdValue || '-'}<span class="pd-unit">mm</span></div>
    <div style="font-size: 10px; color: #666;">[ AI 视觉算法精准测量 ]</div>
  </div>

  <div class="divider"></div>

  <div class="footer">
    温馨提示：<br/>
    1. 新镜佩戴可能有 3-7 天适应期。<br/>
    2. 若有持续眩晕，请及时联系店内验光师调校。<br/>
    3. 请妥善保管此单，作为售后保修凭证。
    <div class="signature">验证人签章: _________</div>
  </div>
</body>
</html>`;

    console.log('【暴力】创建窗口...');
    const win = new BrowserWindow({ show: false });
    
    console.log('【暴力】加载 HTML...');
    const htmlToPrint = typeof htmlContent === 'string' && htmlContent.trim() ? htmlContent : fallbackHtml;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlToPrint)}`);
    
    console.log('【暴力】调用 webContents.print ！！！');
    console.log('【暴力】参数 silent:', true);
    console.log('【暴力】参数 deviceName:', printerName);
    
    try {
      const printOptions = {
        silent: true,
        printBackground: true,
        deviceName: preferredPrinterName,
      };

      // Electron v41 的 print 是 callback 风格，不能直接 await。
      const printResult = await new Promise((resolve, reject) => {
        win.webContents.print(printOptions, (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || '打印任务提交失败'));
            return;
          }
          resolve({ success: true });
        });
      });

      console.log('✅ 【暴力】webContents.print 任务已提交:', printResult);
      // 给系统一点时间把任务送入队列，避免窗口过早销毁导致丢任务
      await new Promise((r) => setTimeout(r, 1200));
      win.destroy();
      return { status: 'success', result: printResult };
    } catch (printErr) {
      const msg = printErr instanceof Error ? printErr.message : String(printErr);
      console.error('❌ 【暴力】webContents.print 失败！！！');
      console.error('❌ 【暴力】failureReason:', msg);
      // 不再回退到 silent:false，避免用户端反复弹出空白文档/另存为
      win.destroy();
      return { status: 'error', failureReason: msg };
    }
    
  } catch (e) {
    console.error('💥 【暴力】异常！');
    console.error('💥 【暴力】异常信息:', e.message);
    console.error('💥 【暴力】异常堆栈:', e.stack);
    return { status: 'error', failureReason: e.message, error: e };
  }
});

ipcMain.handle('get-printers', async () => {
  try {
    const win = new BrowserWindow({ 
      show: true,
      width: 400,
      height: 300
    });
    const list = await win.webContents.getPrintersAsync();
    console.log("系统可用打印机列表：", list.map(p => p.name));
    win.destroy();
    return { ok: true, printers: list.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description || '',
    })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '获取打印机列表失败', printers: [] };
  }
});



function getWindowIconPath() {
  const devIco = path.join(__dirname, 'electron-assets', 'icon.ico');
  const devPng = path.join(__dirname, 'electron-assets', 'icon.png');
  const pkgIco = path.join(process.resourcesPath, 'icon.ico');
  const pkgPng = path.join(process.resourcesPath, 'icon.png');
  if (process.platform === 'win32') {
    if (app.isPackaged && fs.existsSync(pkgIco)) return pkgIco;
    if (fs.existsSync(devIco)) return devIco;
  }
  if (app.isPackaged && fs.existsSync(pkgPng)) return pkgPng;
  if (fs.existsSync(devPng)) return devPng;
  return undefined;
}

 function createWindow() { 
  Menu.setApplicationMenu(null);
   const win = new BrowserWindow({ 
     width: 1200, 
     height: 800, 
     title: '镜售',
     icon: getWindowIconPath(),
     webPreferences: { 
       nodeIntegration: false, // 现代 Next.js 建议关闭，防止变量名冲突
       contextIsolation: true,  // 开启隔离，让 Web 环境更纯粹
       webSecurity: false,      // 允许跨域（Supabase 需要）
       preload: path.join(__dirname, 'preload.js'),
     } 
   }); 

  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let relativePath = `${url.host}${url.pathname}`.replace(/^\/+/, '');
    relativePath = decodeURIComponent(relativePath);
    relativePath = relativePath.replace(/\\/g, '/');
    if (relativePath.startsWith('index.html/')) {
      relativePath = relativePath.slice('index.html/'.length);
    }

    if (!relativePath || relativePath === '.') {
      relativePath = 'index.html';
    }

    const nextIndex = relativePath.indexOf('_next/');
    if (nextIndex >= 0) {
      relativePath = relativePath.slice(nextIndex);
    } else if (relativePath.endsWith('/')) {
      relativePath += 'index.html';
    } else if (!relativePath.includes('.')) {
      relativePath += '/index.html';
    }

    let fullPath = path.join(__dirname, 'out', relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      // 页面路径兜底：不存在时回退首页，避免出现 Not found 空白页
      if (!relativePath.includes('_next/')) {
        fullPath = path.join(__dirname, 'out', 'index.html');
      } else {
        console.warn(`[App Protocol] 404 ${request.url} -> ${fullPath}`);
        return new Response('未找到资源', { status: 404 });
      }
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };

    const data = fs.readFileSync(fullPath);
    console.log(`[App Protocol] ${request.url} -> ${fullPath}`);
    return new Response(data, {
      headers: { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' },
    });
  });

  win.loadURL('app://index.html/cashier/');
 
  // 生产环境默认不打开开发者工具
 } 
 
 app.whenReady().then(createWindow); 

// ===== GlassOrderPrinter 测试：眼镜店验光单专用打印 =====
ipcMain.handle('glass-order-print-test', async (_event, order) => {
  console.log('--- PRINT START ---');
  console.log('[IPC] glass-order-print-test');
  console.log('===== 【GlassOrderPrinter】测试打印被调用 =====');
  try {
    console.log('【GlassOrderPrinter】生成 ESC/POS 指令...');
    
    const escPosContent = glassPrinter.generateESC_POS(order);
    
    console.log('【GlassOrderPrinter】指令生成完成，长度:', escPosContent.length, '字节');
    
    const tempBinPath = path.join(app.getPath('temp'), 'glass_order_print.bin');
    fs.writeFileSync(tempBinPath, escPosContent, 'binary');
    
    console.log('【GlassOrderPrinter】指令文件已创建:', tempBinPath);
    console.log('【GlassOrderPrinter】文件大小:', fs.statSync(tempBinPath).size, '字节');
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const ports = ['LPT1', 'LPT2', 'LPT3', 'COM1', 'COM2', 'COM3', 'USB001', 'USB002'];
    let success = false;
    
    for (const port of ports) {
      try {
        console.log('【GlassOrderPrinter】尝试端口:', port);
        const cmd = `copy /b "${tempBinPath}" "${port}"`;
        console.log('【GlassOrderPrinter】执行命令:', cmd);
        
        const result = await execPromise(cmd);
        
        console.log('【GlassOrderPrinter】端口', port, '成功！');
        console.log('【GlassOrderPrinter】stdout:', result.stdout);
        success = true;
        break;
      } catch (portErr) {
        console.warn('【GlassOrderPrinter】端口', port, '失败:', portErr.message);
      }
    }
    
    if (!success) {
      console.log('【GlassOrderPrinter】端口方式失败，尝试共享方式...');
      const printerName = 'XP-80C';
      const sharePath = `\\\\127.0.0.1\\${printerName}`;
      
      try {
        const cmd = `copy /b "${tempBinPath}" "${sharePath}"`;
        console.log('【GlassOrderPrinter】执行共享命令:', cmd);
        
        const result = await execPromise(cmd);
        
        console.log('【GlassOrderPrinter】共享方式成功！');
        console.log('【GlassOrderPrinter】stdout:', result.stdout);
        success = true;
      } catch (shareErr) {
        console.error('【GlassOrderPrinter】共享方式也失败:', shareErr.message);
      }
    }
    
    console.log('【GlassOrderPrinter】临时文件保留:', tempBinPath);
    
    if (success) {
      console.log('===== 【GlassOrderPrinter】完成！请检查打印机是否出纸 =====');
      return { success: true, tempPath: tempBinPath };
    } else {
      console.error('===== 【GlassOrderPrinter】全部方式都失败！请检查打印机连接 =====');
      return { success: false, error: '全部打印方式失败' };
    }
  } catch (e) {
    console.error('【GlassOrderPrinter】异常:', e);
    console.error('【GlassOrderPrinter】错误信息:', e.message);
    return { success: false, error: e.message };
  }
});

// ===== 暴力测试：RAW 打印 - 直接发送 ESC/POS 指令到 USB 端口 =====
ipcMain.handle('force-test-print', async () => {
  console.log('--- PRINT START ---');
  console.log('[IPC] force-test-print');
  console.log('🚨 信号已收到！force-test-print 被调用！');
  console.log('===== 【暴力测试】force-test-print 被调用 =====');
  try {
    console.log('【暴力测试】使用 RAW 打印 - ESC/POS 指令');
    
    // 构建 ESC/POS 指令
    const esc = '\x1B';
    const gs = '\x1D';
    const cut = gs + 'V' + '\x41' + '\x00'; // 切刀
    const center = esc + 'a' + '\x01'; // 居中对齐
    const left = esc + 'a' + '\x00'; // 左对齐
    const bold = esc + 'E' + '\x01'; // 粗体
    const boldOff = esc + 'E' + '\x00'; // 取消粗体
    const large = esc + '!' + '\x30'; // 大字体
    const normal = esc + '!' + '\x00'; // 正常字体
    
    const testContent = 
      esc + '@' + // 初始化打印机
      large + center + bold +
      '验光单打印测试\n' +
      normal + boldOff + left +
      '================\n' +
      '瞳距：64mm\n' +
      '时间: ' + new Date().toLocaleString() + '\n' +
      '================\n' +
      '\n\n\n\n\n' + // 走纸
      cut; // 切刀
    
    // 创建二进制文件
    console.log('【暴力测试】创建 ESC/POS 指令文件...');
    const tempBinPath = path.join(app.getPath('temp'), 'force_test_raw.bin');
    fs.writeFileSync(tempBinPath, testContent, 'binary');
    
    console.log('【暴力测试】指令文件已创建:', tempBinPath);
    console.log('【暴力测试】文件大小:', fs.statSync(tempBinPath).size, '字节');
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // 尝试多个端口
    const ports = ['LPT1', 'LPT2', 'LPT3', 'COM1', 'COM2', 'COM3', 'USB001', 'USB002'];
    let success = false;
    
    for (const port of ports) {
      try {
        console.log('【暴力测试】尝试端口:', port);
        const cmd = `copy /b "${tempBinPath}" "${port}"`;
        console.log('【暴力测试】执行命令:', cmd);
        
        const result = await execPromise(cmd);
        
        console.log('【暴力测试】端口', port, '成功！');
        console.log('【暴力测试】stdout:', result.stdout);
        success = true;
        break;
      } catch (portErr) {
        console.warn('【暴力测试】端口', port, '失败:', portErr.message);
      }
    }
    
    if (!success) {
      // 尝试共享方式作为备选
      console.log('【暴力测试】端口方式失败，尝试共享方式...');
      const printerName = 'XP-80C';
      const sharePath = `\\\\127.0.0.1\\${printerName}`;
      
      try {
        const cmd = `copy /b "${tempBinPath}" "${sharePath}"`;
        console.log('【暴力测试】执行共享命令:', cmd);
        
        const result = await execPromise(cmd);
        
        console.log('【暴力测试】共享方式成功！');
        console.log('【暴力测试】stdout:', result.stdout);
        success = true;
      } catch (shareErr) {
        console.error('【暴力测试】共享方式也失败:', shareErr.message);
      }
    }
    
    // 保留文件供检查
    console.log('【暴力测试】临时文件保留:', tempBinPath);
    
    if (success) {
      console.log('===== 【暴力测试】完成！请检查打印机是否出纸 =====');
      return { ok: true };
    } else {
      console.error('===== 【暴力测试】全部方式都失败！请检查打印机连接 =====');
      return { ok: false, error: '全部打印方式失败' };
    }
  } catch (e) {
    console.error('【暴力测试】异常:', e);
    console.error('【暴力测试】错误信息:', e.message);
    console.error('【暴力测试】错误堆栈:', e.stack);
    return { ok: false, error: e.message };
  }
});

 app.on('window-all-closed', () => {
   if (process.platform !== 'darwin') app.quit();
 });
