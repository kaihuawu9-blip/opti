const { request } = require('../../utils/request');

Page({
  data: {
    loading: false,
    greeting: '小程序仅展示结果，AI 逻辑由后端完成。',
    profileText: '',
    canDebugRoleSwitch: false
  },

  onLoad() {
    const app = getApp();
    this.setData({
      canDebugRoleSwitch: !!(app.globalData && app.globalData.canDebugRoleSwitch)
    });
  },

  onShow() {},

  goScanEntry() {
    wx.navigateTo({
      url: '/pages/scan-entry/scan-entry'
    });
  },

  goLensTintPage() {
    wx.navigateTo({
      url: '/pages/lens-tint/index'
    });
  },

  switchToStaffRole() {
    const app = getApp();
    wx.showModal({
      title: '切换角色',
      content: '确认切换到店员端进行联调吗？',
      confirmText: '确认切换',
      success: (res) => {
        if (res.confirm) {
          app.switchRoleForDebug('staff');
        }
      }
    });
  },

  loadProfile() {
    this.setData({ loading: true });

    request({
      url: '/api/miniprogram/customer/profile'
    })
      .then((data) => {
        this.setData({
          profileText: `欢迎你，${(data && data.name) || '顾客'}`,
          loading: false
        });
      })
      .catch((error) => {
        this.setData({ loading: false });
        wx.showToast({
          title: error.message || '加载失败',
          icon: 'none'
        });
      });
  }
});
