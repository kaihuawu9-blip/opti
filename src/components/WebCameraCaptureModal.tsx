'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

export type WebCameraCaptureModalProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  /** 返回 JPEG Blob；可 async（例如再压缩后写库） */
  onCapture: (blob: Blob) => void | Promise<void>;
};

/**
 * 桌面端「拍照」：用 getUserMedia 预览 + 抓拍，避免仅靠 &lt;input capture&gt; 被浏览器当成「选取文件」。
 */
export function WebCameraCaptureModal({
  open,
  title = '摄像头拍照',
  onClose,
  onCapture,
}: WebCameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopStream();
      setError(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          setError('当前浏览器不支持摄像头 API，请改用「相册选图」。');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.playsInline = true;
          v.muted = true;
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '无法打开摄像头（请检查权限与 HTTPS / localhost）');
        }
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, stopStream]);

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError('预览未就绪，请稍候再抓拍。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法读取画面');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('无法导出 JPEG'));
          },
          'image/jpeg',
          0.92,
        );
      });
      await onCapture(blob);
      stopStream();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    stopStream();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 p-3">
      <div
        className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-4 shadow-xl space-y-3"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webcam-capture-title"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="webcam-capture-title" className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="h-full w-full object-contain" playsInline muted autoPlay />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !!error}
            onClick={() => void handleCapture()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Camera className="h-4 w-4" aria-hidden />
            {busy ? '处理中…' : '抓拍并识别'}
          </button>
        </div>
        <p className="text-[10px] text-gray-500 leading-snug">
          需浏览器授权摄像头；内网 HTTP 时部分浏览器会拦截，可改用本机 localhost 或 HTTPS。
        </p>
      </div>
    </div>
  );
}
