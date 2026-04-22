/**
 * ESC/POS 热敏打印机工具
 * 用于直接向打印机发送原始指令
 */

export interface PrintLineItem {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 'normal' | 'double' | 'quad';
}

export interface PrintReceiptData {
  storeName?: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: string;
  totalAmount: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  createdAt: string;
}

/**
 * 生成 ESC/POS 打印指令（纯文本格式，用于调试）
 */
export function generateEscPosCommands(data: PrintReceiptData): string {
  const lines: string[] = [];
  
  // 初始化
  lines.push('[ESC]@'); // 初始化打印机
  
  // 居中、加粗、双倍大小打印店名
  if (data.storeName) {
    lines.push('[ESC]a[CENTER]');
    lines.push('[ESC]![BOLD][DOUBLE]');
    lines.push(data.storeName);
    lines.push('[LF]');
  }
  
  // 分隔线
  lines.push('[ESC]![NORMAL]');
  lines.push('[ESC]a[LEFT]');
  lines.push('--------------------------------');
  lines.push('[LF]');
  
  // 订单信息
  lines.push(`单据号: ${data.orderNo}`);
  lines.push('[LF]');
  lines.push(`客人: ${data.customerName} (${data.customerPhone})`);
  lines.push('[LF]');
  lines.push(`支付方式: ${data.paymentMethod}`);
  lines.push('[LF]');
  lines.push(`时间: ${new Date(data.createdAt).toLocaleString()}`);
  lines.push('[LF]');
  
  // 分隔线
  lines.push('--------------------------------');
  lines.push('[LF]');
  
  // 商品明细
  data.items.forEach(item => {
    lines.push(`${item.name} x${item.quantity}`);
    lines.push('[LF]');
    lines.push(`  单价: ¥${item.unitPrice.toFixed(2)}  小计: ¥${item.lineTotal.toFixed(2)}`);
    lines.push('[LF]');
  });
  
  // 分隔线
  lines.push('--------------------------------');
  lines.push('[LF]');
  
  // 总计（居中、加粗、双倍大小）
  lines.push('[ESC]a[CENTER]');
  lines.push('[ESC]![BOLD][DOUBLE]');
  lines.push(`总计: ¥${data.totalAmount.toFixed(2)}`);
  lines.push('[LF]');
  lines.push('[ESC]![NORMAL]');
  lines.push('[ESC]a[LEFT]');
  
  // 空行
  lines.push('[LF]');
  lines.push('[LF]');
  lines.push('[LF]');
  
  // 切纸
  lines.push('[GS]V[65][0]'); // 部分切纸
  // 或者 lines.push('[GS]V[66][0]'); // 完全切纸
  
  return lines.join('');
}

/**
 * 生成简单的测试打印指令
 */
export function generateTestPrint(printerName: string): string {
  const lines: string[] = [];
  
  lines.push('[ESC]@'); // 初始化
  lines.push('[ESC]a[CENTER]');
  lines.push('[ESC]![BOLD][DOUBLE]');
  lines.push('打印机配置成功');
  lines.push('[LF]');
  lines.push('[ESC]![NORMAL]');
  lines.push('[LF]');
  lines.push(`打印机名称: ${printerName}`);
  lines.push('[LF]');
  lines.push(`测试时间: ${new Date().toLocaleString()}`);
  lines.push('[LF]');
  lines.push('[LF]');
  lines.push('[LF]');
  lines.push('[GS]V[65][0]'); // 切纸
  
  return lines.join('');
}
