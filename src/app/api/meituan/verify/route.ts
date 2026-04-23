import { NextResponse } from 'next/server';

/**
 * @deprecated 美团外卖核销已下线。
 * 历史路由保留，直接返回 410 Gone，避免前端持续重试。
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: false,
      error: '美团外卖核销已下线；请改用「OCR 数据海关」(dataAdapter) 建立标准订单。',
      deprecated: true,
    },
    { status: 410 },
  );
}
