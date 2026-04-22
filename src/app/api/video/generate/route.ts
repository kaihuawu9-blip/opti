import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const execPromise = promisify(exec);

function escapeDrawtextText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\n/g, '\\n');
}

function shellQuoteFilePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, `'\\''`);
}

export async function POST(req: NextRequest) {
  let tempInput: string | null = null;
  try {
    const body = (await req.json()) as {
      imageUrl?: string;
      imageDataUrl?: string;
      copywrite?: string;
    };
    const imageUrl = (body.imageUrl || '').trim();
    const imageDataUrl = (body.imageDataUrl || '').trim();
    const copywrite = (body.copywrite || '').trim();
    if (!copywrite) {
      return NextResponse.json({ error: 'copywrite 不能为空' }, { status: 400 });
    }

    let inputForFfmpeg = '';

    if (imageDataUrl.startsWith('data:image')) {
      const comma = imageDataUrl.indexOf(',');
      if (comma <= 0) {
        return NextResponse.json({ error: 'imageDataUrl 格式无效' }, { status: 400 });
      }
      const b64 = imageDataUrl.slice(comma + 1);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 8 * 1024 * 1024) {
        return NextResponse.json({ error: '图片过大' }, { status: 413 });
      }
      tempInput = path.join('/tmp', `vf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.png`);
      fs.writeFileSync(tempInput, buf);
      inputForFfmpeg = tempInput;
    } else if (imageUrl) {
      inputForFfmpeg = imageUrl;
    } else {
      return NextResponse.json({ error: '请提供 imageUrl 或 imageDataUrl' }, { status: 400 });
    }

    const outputId = `video_${Date.now()}`;
    const outputPath = path.join('/tmp', `${outputId}.mp4`);
    const logoPath = path.join(process.cwd(), 'public/logo-watermark.png');
    const hasLogo = fs.existsSync(logoPath);
    const safeCopywrite = escapeDrawtextText(copywrite.slice(0, 72));
    const qIn = shellQuoteFilePath(inputForFfmpeg);
    const qOut = shellQuoteFilePath(outputPath);
    const qLogo = shellQuoteFilePath(logoPath);
    const baseFilter =
      `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[bg];` +
      `[bg]drawtext=text='${safeCopywrite}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black:shadowx=2:shadowy=2[txt]`;
    const filterComplex = hasLogo
      ? `${baseFilter};[txt][1:v]overlay=main_w-overlay_w-40:main_h-overlay_h-40`
      : baseFilter;
    const ffmpegCmd = hasLogo
      ? `ffmpeg -y -loop 1 -i '${qIn}' -i '${qLogo}' -filter_complex "${filterComplex}" -t 10 -pix_fmt yuv420p '${qOut}'`
      : `ffmpeg -y -loop 1 -i '${qIn}' -filter_complex "${filterComplex}" -t 10 -pix_fmt yuv420p '${qOut}'`;
    try {
      await execPromise(ffmpegCmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `ffmpeg 执行失败: ${msg}` }, { status: 500 });
    }

    const videoBuffer = fs.readFileSync(outputPath);
    fs.unlinkSync(outputPath);
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: `视频生成失败: ${msg}` }, { status: 500 });
  } finally {
    if (tempInput && fs.existsSync(tempInput)) {
      try {
        fs.unlinkSync(tempInput);
      } catch {
        /* ignore */
      }
    }
  }
}
