Page({
  onLoad() {},

  onShow() {},

  goCustomer() {
    getApp().globalData.role = 'customer';
    wx.navigateTo({
      url: '/pages/customer/home'
    });
  },

  goStaff() {
    getApp().globalData.role = 'staff';
    wx.navigateTo({
      url: '/pages/staff/home'
    });
  }
});
