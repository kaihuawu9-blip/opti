const { dispatchDeviceCommand } = require('../../utils/device');

Page({
  data: {
    loading: false,
    resultText: '',
    canDebugRoleSwitch: false
  },

  onLoad() {
    const app = getApp();
    this.setData({
      canDebugRoleSwitch: !!(app.globalData && app.globalData.canDebugRoleSwitch)
    });
    app.ensureRoleAccess('staff');
  },

  onShow() {
    const app = getApp();
    app.ensureRoleAccess('staff');
  },

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

  switchToCustomerRole() {
    const app = getApp();
    wx.showModal({
      title: '切换角色',
      content: '确认切换到顾客端进行联调吗？',
      confirmText: '确认切换',
      success: (res) => {
        if (res.confirm) {
          app.switchRoleForDebug('customer');
        }
      }
    });
  },

  sendSyncCommand() {
    this.setData({ loading: true });

    dispatchDeviceCommand({
      command: 'lens_sync',
      source: 'staff_miniprogram'
    })
      .then((data) => {
        this.setData({
          loading: false,
          resultText: `指令已发送：${(data && data.requestId) || 'unknown'}`
        });
      })
      .catch((error) => {
        this.setData({ loading: false });
        wx.showToast({
          title: error.message || '发送失败',
          icon: 'none'
        });
      });
  }
});
