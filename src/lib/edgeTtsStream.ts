/**
 * 通过 Microsoft Edge Read Aloud 使用的 WebSocket 协议合成语音（与 node-edge-tts 同源思路）。
 * 输出为 MP3 字节流片段，可由 HTTP chunked 转发给浏览器。
 */
import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;

function generateSecMsGecToken(): string {
  const ticks = BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
  return createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return c;
    }
  });
}

const AUDIO_SEP = Buffer.from('Path:audio\r\n');

export type EdgeTtsStreamOptions = {
  voice?: string;
  lang?: string;
  outputFormat?: string;
  timeoutMs?: number;
};

/**
 * 创建 Edge TTS 的 MP3 流（各 chunk 为 MP3 片段，浏览器端顺序 append 到 MSE）。
 */
export function createEdgeTtsMp3ReadableStream(text: string, opts: EdgeTtsStreamOptions = {}): ReadableStream<Uint8Array> {
  const voice = (opts.voice || 'zh-CN-YunzeNeural').trim();
  const lang = (opts.lang || 'zh-CN').trim();
  const outputFormat = opts.outputFormat || 'audio-24khz-48kbitrate-mono-mp3';
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const body = String(text || '').trim();
  if (!body) {
    return new ReadableStream({
      start(c) {
        c.close();
      },
    });
  }

  let ws: WebSocket | null = null;
  let timeout: NodeJS.Timeout | null = null;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeClose = () => {
        if (closed) return;
        closed = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
        ws = null;
      };

      const safeError = (err: unknown) => {
        if (closed) return;
        closed = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        try {
          controller.error(err instanceof Error ? err : new Error(String(err)));
        } catch {
          // ignore
        }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
        ws = null;
      };

      const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
      const major = CHROMIUM_FULL_VERSION.split('.')[0] || '143';

      ws = new WebSocket(url, {
        host: 'speech.platform.bing.com',
        origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      timeout = setTimeout(() => {
        safeError(new Error('Edge TTS 超时'));
      }, timeoutMs);

      try {
        await new Promise<void>((resolve, reject) => {
          const onErr = (e: Error) => reject(e);
          ws!.once('error', onErr);
          ws!.once('open', () => {
            ws!.off('error', onErr);
            try {
              ws!.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n
{
  "context": {
    "synthesis": {
      "audio": {
        "metadataoptions": {
          "sentenceBoundaryEnabled": "false",
          "wordBoundaryEnabled": "false"
        },
        "outputFormat": "${outputFormat}"
      }
    }
  }
}
`);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });

        const requestId = randomBytes(16).toString('hex');
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeXml(lang)}">
  <voice name="${escapeXml(voice)}">
    <prosody rate="default" pitch="default" volume="default">
      ${escapeXml(body)}
    </prosody>
  </voice>
</speak>`;
        ws!.send(
          `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` + ssml,
        );

        ws!.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
          if (closed) return;
          try {
            if (isBinary) {
              const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
              const idx = buf.indexOf(AUDIO_SEP);
              if (idx >= 0) {
                const audioData = buf.subarray(idx + AUDIO_SEP.length);
                if (audioData.length) controller.enqueue(new Uint8Array(audioData));
              }
              return;
            }
            const message = data.toString();
            if (message.includes('Path:turn.end')) {
              safeClose();
            }
          } catch (e) {
            safeError(e);
          }
        });

        ws!.on('error', (e) => safeError(e));
      } catch (e) {
        safeError(e);
      }
    },
    cancel() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      closed = true;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      ws = null;
    },
  });
}
