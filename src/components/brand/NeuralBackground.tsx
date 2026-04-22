'use client';

import { useEffect, useRef } from 'react';

type Node = { x: number; y: number; vx: number; vy: number };

/**
 * 深蓝调「神经元」背景：曲边连线若隐若现流动，意象接近镜框弧线。
 */
export function NeuralBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const ctx = g;

    let nodes: Node[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = true;

    function spawnNodes() {
      const area = w * h;
      const count = Math.min(72, Math.max(32, Math.floor(area / 26000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
      }));
    }

    function resize() {
      const el = ref.current;
      if (!el) return;
      const c = el.getContext('2d');
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawnNodes();
    }

    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    function loop() {
      if (!running) return;
      t += 0.014;

      ctx.fillStyle = '#030816';
      ctx.fillRect(0, 0, w, h);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x <= 0 || n.x >= w) n.vx *= -1;
        if (n.y <= 0 || n.y >= h) n.vy *= -1;
        n.x = Math.max(2, Math.min(w - 2, n.x));
        n.y = Math.max(2, Math.min(h - 2, n.y));
      }

      const maxD = Math.min(200, (w + h) * 0.12);
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > maxD) continue;
          const flow = 0.55 + 0.45 * Math.sin(t * 1.15 + i * 0.4 + j * 0.07 + d * 0.02);
          const opacity = (1 - d / maxD) * (0.06 + 0.1 * flow);
          ctx.strokeStyle = `rgba(56, 189, 248, ${opacity})`;
          ctx.lineWidth = 0.55 + (1 - d / maxD) * 0.35;
          const mx = (a.x + b.x) / 2 + Math.sin(t * 0.65 + i * 0.2) * 22;
          const my = (a.y + b.y) / 2 + Math.cos(t * 0.55 + j * 0.25) * 22;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        const pulse = 0.2 + 0.12 * Math.sin(t * 2.1 + n.x * 0.008 + n.y * 0.006);
        ctx.fillStyle = `rgba(186, 230, 253, ${pulse})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
