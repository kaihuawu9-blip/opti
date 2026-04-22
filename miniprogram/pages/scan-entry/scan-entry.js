Page({
  data: {
    scanning: false,
    lastResult: ''
  },

  onLoad() {},

  onShow() {},

  scanOrder() {
    if (this.data.scanning) return;

    this.setData({ scanning: true });
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const raw = (res.result || res.path || '').trim();
        if (!raw) {
          wx.showToast({
            title: '未识别到有效二维码内容',
            icon: 'none'
          });
          return;
        }

        this.setData({ lastResult: raw });
        wx.navigateTo({
          url: `/pages/view-order/view-order?q=${encodeURIComponent(raw)}`
        });
      },
      fail: () => {
        wx.showToast({
          title: '扫码已取消或失败',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({ scanning: false });
      }
    });
  }
});
