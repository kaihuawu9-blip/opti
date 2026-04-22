import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** 仅允许白名单域名，避免开放代理被滥用 */
function isAllowedImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h.endsWith('.wikimedia.org') || h === 'upload.wikimedia.org') return true;
  if (h.endsWith('.aliyuncs.com')) return true;
  if (h === 'image.pollinations.ai') return true;
  if (h === 'opti-ai.cn' || h.endsWith('.opti-ai.cn')) return true;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  const extra = (process.env.MARKETING_IMAGE_PROXY_HOSTS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.some((e) => h === e || h.endsWith(`.${e}`));
}

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get('url');
    if (!raw?.trim()) {
      return NextResponse.json({ ok: false, error: 'missing url' }, { status: 400 });
    }
    let target: URL;
    try {
      target = new URL(raw.trim());
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid url' }, { status: 400 });
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return NextResponse.json({ ok: false, error: 'unsupported protocol' }, { status: 400 });
    }
    if (!isAllowedImageHost(target.hostname)) {
      return NextResponse.json({ ok: false, error: 'host not allowed' }, { status: 403 });
    }

    const resp = await fetch(target.toString(), {
      headers: {
        Accept: 'image/*,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; OptiAI-Poster/1.0)',
      },
      redirect: 'follow',
    });
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `upstream ${resp.status}` }, { status: 502 });
    }
    const ct = resp.headers.get('content-type') || 'application/octet-stream';
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) {
      return NextResponse.json({ ok: false, error: 'not an image' }, { status: 502 });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'image too large' }, { status: 413 });
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': ct.split(';')[0].trim(),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
