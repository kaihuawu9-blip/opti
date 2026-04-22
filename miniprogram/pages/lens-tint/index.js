const { fetchLensTintConfig } = require('../../utils/lensTintConfig');

Page({
  data: {
    loading: false,
    errorText: '',
    tintColors: [],
    selectedTintId: '',
    selectedTintName: '',
    selectedTintHex: '',
    selectedTintSurchargeYuan: 0
  },

  onLoad(options = {}) {
    this.options = options || {};
    this.isPickerMode = String(options.mode || '') === 'picker';
    const selectedTintId = (options.selectedTintId || '').trim();
    if (selectedTintId) {
      this.setData({ selectedTintId });
    }
    this.loadTintColors();
  },

  onReady() {
    this.drawPreview({
      name: '请选择染色',
      hex: '#cbd5e1',
      opacity: 0.3
    });
  },

  onShow() {
    // 运营改云端 JSON 后，页面每次进入尽量获取新配置（同时保留 60s 短缓存兜底）。
    this.loadTintColors({ forceRefresh: true });
  },

  onPullDownRefresh() {
    this.loadTintColors({ forceRefresh: true, stopRefreshAfterDone: true });
  },

  loadTintColors(options = {}) {
    const { forceRefresh = false, stopRefreshAfterDone = false } = options;
    this.setData({ loading: true, errorText: '' });

    fetchLensTintConfig({ forceRefresh })
      .then((config) => {
        const tintColors = config.colors || [];
        const currentSelectedId = this.data.selectedTintId;
        const selectedItem =
          tintColors.find((x) => x.id === currentSelectedId) || tintColors[0] || null;

        this.setData({
          loading: false,
          tintColors,
          selectedTintId: selectedItem ? selectedItem.id : '',
          selectedTintName: selectedItem ? selectedItem.name : '',
          selectedTintHex: selectedItem ? selectedItem.hex : '',
          selectedTintSurchargeYuan: selectedItem ? Number(selectedItem.surchargeYuan || 0) : 0
        });
        wx.nextTick(() => {
          this.drawPreview(selectedItem);
        });
      })
      .catch((error) => {
        this.setData({
          loading: false,
          errorText: (error && error.message) || '加载失败'
        });
      })
      .finally(() => {
        if (stopRefreshAfterDone) {
          wx.stopPullDownRefresh();
        }
      });
  },

  drawPreview(tint) {
    const ctx = wx.createCanvasContext('tintPreviewCanvas', this);
    const width = 640;
    const height = 280;
    const color = tint && tint.hex ? tint.hex : '#cbd5e1';
    const opacity = Number(tint && tint.opacity);
    const alpha = Number.isFinite(opacity) ? Math.max(0.15, Math.min(0.85, opacity)) : 0.35;

    ctx.setFillStyle('#f8fafc');
    ctx.fillRect(0, 0, width, height);

    ctx.setStrokeStyle('#cbd5e1');
    ctx.setLineWidth(6);
    ctx.beginPath();
    ctx.arc(220, 140, 86, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(420, 140, 86, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.setGlobalAlpha(alpha);
    ctx.setFillStyle(color);
    ctx.beginPath();
    ctx.arc(220, 140, 80, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(420, 140, 80, 0, 2 * Math.PI);
    ctx.fill();
    ctx.setGlobalAlpha(1);

    ctx.setStrokeStyle('#94a3b8');
    ctx.setLineWidth(2);
    ctx.beginPath();
    ctx.moveTo(300, 140);
    ctx.lineTo(340, 140);
    ctx.stroke();

    ctx.draw();
  },

  pickTint(event) {
    const ds = event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : null;
    if (!ds || !ds.id) {
      return;
    }

    const selected = {
      id: String(ds.id || '').trim(),
      name: String(ds.name || ds.id || '').trim(),
      hex: String(ds.hex || '').trim(),
      opacity: Number(ds.opacity),
      materialSku: ds.materialSku || null,
      surchargeYuan: Number.isFinite(Number(ds.surchargeYuan)) ? Math.max(0, Number(ds.surchargeYuan)) : 0
    };
    if (!selected.id || !selected.hex) return;

    this.setData({
      selectedTintId: selected.id,
      selectedTintName: selected.name,
      selectedTintHex: selected.hex,
      selectedTintSurchargeYuan: selected.surchargeYuan
    });
    wx.nextTick(() => {
      this.drawPreview(selected);
    });

    const app = getApp();
    if (app && app.globalData) {
      app.globalData.selectedLensTint = selected;
    }

    if (!this.isPickerMode) {
      wx.navigateTo({
        url:
          `/pages/lens-tint-preview/index` +
          `?id=${encodeURIComponent(selected.id)}` +
          `&name=${encodeURIComponent(selected.name)}` +
          `&hex=${encodeURIComponent(selected.hex)}` +
          `&opacity=${encodeURIComponent(String(Number.isFinite(selected.opacity) ? selected.opacity : 0.35))}` +
          `&surchargeYuan=${encodeURIComponent(String(selected.surchargeYuan || 0))}`
      });
      return;
    }

    const eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (eventChannel && eventChannel.emit) eventChannel.emit('lensTintSelected', selected);
    wx.navigateBack({ delta: 1 });
  }
});

