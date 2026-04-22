function defaultReport() {
  return {
    right: {
      sphere: '-2.50',
      cylinder: '-0.75',
      axis: '180'
    },
    left: {
      sphere: '-2.25',
      cylinder: '-0.50',
      axis: '175'
    },
    pd: '64',
    aiThickness: {
      refractiveIndex: '1.67',
      estimatedEdge: '约 4.2 mm',
      level: '中薄优选',
      advice: '建议搭配 1.67 非球面镜片，兼顾厚度控制与清晰度。'
    }
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

Page({
  data: {
    storePhone: '400-800-8899',
    reportDateText: '',
    report: defaultReport()
  },

  onLoad(options) {
    const today = new Date();
    const dateText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;

    let nextReport = defaultReport();
    const encodedReport = options.report ? decodeURIComponent(options.report) : '';
    if (encodedReport) {
      const parsed = safeJsonParse(encodedReport);
      if (parsed && typeof parsed === 'object') {
        nextReport = Object.assign(defaultReport(), parsed);
      }
    }

    this.setData({
      reportDateText: options.reportDate || dateText,
      storePhone: options.storePhone || this.data.storePhone,
      report: nextReport
    });
  },

  onShow() {},

  contactOptician() {
    const app = getApp();
    const serviceConfig = (app && app.globalData && app.globalData.customerService) || {};
    const actions = [];

    if (serviceConfig.corpId && serviceConfig.url) {
      actions.push({
        name: '在线咨询客服',
        type: 'service'
      });
    }
    if (this.data.storePhone) {
      actions.push({
        name: `拨打门店电话（${this.data.storePhone}）`,
        type: 'phone'
      });
    }

    if (actions.length === 0) {
      wx.showToast({
        title: '暂未配置联系方式',
        icon: 'none'
      });
      return;
    }

    wx.showActionSheet({
      itemList: actions.map((x) => x.name),
      success: (res) => {
        const picked = actions[res.tapIndex];
        if (!picked) return;

        if (picked.type === 'service') {
          wx.openCustomerServiceChat({
            extInfo: {
              url: serviceConfig.url
            },
            corpId: serviceConfig.corpId,
            fail: () => {
              wx.showToast({
                title: '客服暂不可用，请改为电话咨询',
                icon: 'none'
              });
            }
          });
          return;
        }

        wx.makePhoneCall({
          phoneNumber: this.data.storePhone,
          fail: () => {
            wx.showToast({
              title: '拨号失败，请稍后重试',
              icon: 'none'
            });
          }
        });
      }
    });
  }
});
