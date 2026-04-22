import * as THREE from 'three';

/** 轻量「店面灯光感」标准 CubeMap：六面暖冷渐变，经 PMREM 后给镜片流动高光 */
export function createStoreFlowCubeTexture(): THREE.CubeTexture {
  const size = 64;
  const palettes = [
    ['#fff8f0', '#ffd9b8'],
    ['#f0f8ff', '#c8e0ff'],
    ['#fff5f8', '#ffc8dd'],
    ['#f8fff4', '#d4f0c4'],
    ['#f5f4ff', '#dcd6ff'],
    ['#fffef5', '#ffe9a8'],
  ] as const;

  const canvases: HTMLCanvasElement[] = [];
  for (let i = 0; i < 6; i += 1) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) continue;
    const [a, b] = palettes[i] ?? palettes[0];
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, a);
    g.addColorStop(0.55, b);
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    canvases.push(c);
  }

  const cube = new THREE.CubeTexture(canvases);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  return cube;
}
