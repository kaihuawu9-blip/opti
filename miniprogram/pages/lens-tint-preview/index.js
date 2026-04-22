Page({
  data: {
    tint: {
      id: '',
      name: '',
      hex: '#cbd5e1',
      opacity: 0.35,
      surchargeYuan: 0
    }
  },

  onLoad(options = {}) {
    const hex = String(options.hex || '').trim() || '#cbd5e1';
    const opacityNum = Number(options.opacity);
    const surchargeNum = Number(options.surchargeYuan);
    const tint = {
      id: String(options.id || '').trim(),
      name: String(options.name || '').trim() || '镜片染色',
      hex,
      opacity: Number.isFinite(opacityNum) ? Math.max(0, Math.min(1, opacityNum)) : 0.35,
      surchargeYuan: Number.isFinite(surchargeNum) ? Math.max(0, surchargeNum) : 0
    };
    this.setData({ tint });
  },

  onReady() {
    this.drawPreview();
  },

  drawPreview() {
    const tint = this.data.tint || {};
    const ctx = wx.createCanvasContext('fullTintPreviewCanvas', this);
    const width = 720;
    const height = 980;
    const alpha = Number.isFinite(Number(tint.opacity)) ? Math.max(0.15, Math.min(0.9, Number(tint.opacity))) : 0.35;
    const color = tint.hex || '#cbd5e1';

    ctx.setFillStyle('#f8fafc');
    ctx.fillRect(0, 0, width, height);

    ctx.setFillStyle('#0f172a');
    ctx.setFontSize(30);
    ctx.fillText(tint.name || '镜片染色', 38, 72);

    ctx.setFillStyle('#475569');
    ctx.setFontSize(22);
    ctx.fillText(`Hex: ${tint.hex || '--'}   透明度: ${Number(tint.opacity || 0).toFixed(2)}`, 38, 110);
    ctx.fillText(`加价: ¥${Number(tint.surchargeYuan || 0).toFixed(2)}`, 38, 142);

    ctx.setStrokeStyle('#94a3b8');
    ctx.setLineWidth(8);
    ctx.beginPath();
    ctx.arc(260, 510, 168, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(460, 510, 168, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.setGlobalAlpha(alpha);
    ctx.setFillStyle(color);
    ctx.beginPath();
    ctx.arc(260, 510, 160, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(460, 510, 160, 0, 2 * Math.PI);
    ctx.fill();
    ctx.setGlobalAlpha(1);

    ctx.setStrokeStyle('#64748b');
    ctx.setLineWidth(3);
    ctx.beginPath();
    ctx.moveTo(338, 510);
    ctx.lineTo(382, 510);
    ctx.stroke();

    ctx.draw();
  }
});
