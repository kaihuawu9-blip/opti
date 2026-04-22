const API_BASE_URL = 'https://opti-ai.cn';

function getToken() {
  return wx.getStorageSync('token') || wx.getStorageSync('NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN') || '';
}

App({
  globalData: {
    role: '',
    user: null,
    apiBaseUrl: API_BASE_URL,
    authReady: false,
    canDebugRoleSwitch: false,
    selectedLensTint: null
  },

  _homeRouted: false,

  onLaunch() {
    this.globalData.canDebugRoleSwitch = this.detectDebugMode();
    this.bootstrapSession();
  },

  onShow() {
    if (this.globalData.authReady) {
      this.routeHomeByRoleIfNeeded();
    }
  },

  bootstrapSession() {
    const token = getToken();
    if (!token) {
      this.globalData.authReady = true;
      return;
    }

    wx.request({
      url: `${API_BASE_URL}/api/auth/me`,
      method: 'GET',
      timeout: 12000,
      header: {
        Authorization: `Bearer ${token}`
      },
      success: (res) => {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && data.ok && data.user) {
          this.globalData.user = data.user;
          this.globalData.role = data.role || data.user.role || 'customer';
        } else {
          this.globalData.user = null;
          this.globalData.role = '';
        }
      },
      fail: () => {
        this.globalData.user = null;
        this.globalData.role = '';
      },
      complete: () => {
        this.globalData.authReady = true;
        this.routeHomeByRoleIfNeeded();
      }
    });
  },

  routeHomeByRoleIfNeeded() {
    if (this._homeRouted || !this.globalData.role) {
      return;
    }

    const pages = getCurrentPages();
    if (!pages || pages.length === 0) {
      return;
    }

    const currentRoute = pages[pages.length - 1].route;
    if (currentRoute !== 'pages/index/index') {
      return;
    }

    this._homeRouted = true;
    const target = this.globalData.role === 'staff' ? '/pages/staff/home' : '/pages/customer/home';
    wx.reLaunch({
      url: target
    });
  },

  ensureRoleAccess(requiredRole) {
    const role = this.globalData.role;
    if (role === requiredRole) {
      return true;
    }

    wx.showToast({
      title: '无权限',
      icon: 'none'
    });

    const fallback = role === 'staff' ? '/pages/staff/home' : '/pages/customer/home';
    wx.reLaunch({
      url: fallback
    });
    return false;
  },

  detectDebugMode() {
    try {
      const info = wx.getAccountInfoSync();
      const envVersion = info && info.miniProgram && info.miniProgram.envVersion;
      return envVersion !== 'release';
    } catch (e) {
      return true;
    }
  },

  switchRoleForDebug(nextRole) {
    if (!this.globalData.canDebugRoleSwitch) {
      return;
    }

    const role = nextRole === 'staff' ? 'staff' : 'customer';
    this.globalData.role = role;
    if (this.globalData.user) {
      this.globalData.user.role = role;
    }

    const target = role === 'staff' ? '/pages/staff/home' : '/pages/customer/home';
    wx.reLaunch({
      url: target
    });
  }
});
