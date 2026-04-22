const { request } = require('../../utils/request');

function parseQueryString(queryString) {
  const params = {};
  const str = (queryString || '').replace(/^\?/, '');
  if (!str) return params;

  str.split('&').forEach((pair) => {
    if (!pair) return;
    const parts = pair.split('=');
    const key = decodeURIComponent(parts[0] || '').trim();
    const val = decodeURIComponent(parts.slice(1).join('=') || '').trim();
    if (key) params[key] = val;
  });
  return params;
}

function parseOrderParamsFromQ(qValue) {
  const decoded = decodeURIComponent(qValue || '').trim();
  if (!decoded) return { orderId: '', orderNo: '' };

  const queryIndex = decoded.indexOf('?');
  if (queryIndex >= 0) {
    const query = decoded.slice(queryIndex + 1);
    const params = parseQueryString(query);
    return {
      orderId: params.orderId || params.id || '',
      orderNo: params.orderNo || ''
    };
  }

  if (decoded.indexOf('=') >= 0 && decoded.indexOf('&') >= 0) {
    const params = parseQueryString(decoded);
    return {
      orderId: params.orderId || params.id || '',
      orderNo: params.orderNo || ''
    };
  }

  return {
    orderId: decoded,
    orderNo: ''
  };
}

function normalizeMetric(v) {
  return v === null || v === undefined || v === '' ? '--' : `${v}`;
}

Page({
  data: {
    loading: true,
    error: '',
    order: null,
    tintInfo: null
  },

  onLoad(options) {
    const fromQ = parseOrderParamsFromQ(options.q || '');
    const orderId = (options.orderId || fromQ.orderId || '').trim();
    const orderNo = (options.orderNo || fromQ.orderNo || '').trim();

    if (!orderId && !orderNo) {
      this.setData({
        loading: false,
        error: '二维码参数无效，未解析到订单编号'
      });
      return;
    }

    this.fetchOrderDetail(orderId, orderNo);
  },

  onShow() {},

  fetchOrderDetail(orderId, orderNo) {
    this.setData({ loading: true, error: '' });
    request({
      url: '/api/miniprogram/order-detail',
      method: 'POST',
      data: {
        orderId,
        orderNo
      }
    })
      .then((res) => {
        if (!res || !res.ok || !res.data) {
          throw new Error((res && res.error) || '订单数据为空');
        }

        const data = res.data;
        const presetTint =
          data.tintInfo && data.tintInfo.id
            ? {
                id: data.tintInfo.id,
                name: data.tintInfo.name || data.tintInfo.id,
                hex: data.tintInfo.hex || '',
                surchargeYuan: Number.isFinite(Number(data.tintInfo.surchargeYuan))
                  ? Math.max(0, Number(data.tintInfo.surchargeYuan))
                  : 0
              }
            : null;
        const order = {
          ...data,
          lensThicknessText: normalizeMetric(data.lensThickness),
          prescription: {
            ...data.prescription,
            right: {
              ds: normalizeMetric(data.prescription && data.prescription.right && data.prescription.right.ds),
              dc: normalizeMetric(data.prescription && data.prescription.right && data.prescription.right.dc),
              axis: normalizeMetric(data.prescription && data.prescription.right && data.prescription.right.axis)
            },
            left: {
              ds: normalizeMetric(data.prescription && data.prescription.left && data.prescription.left.ds),
              dc: normalizeMetric(data.prescription && data.prescription.left && data.prescription.left.dc),
              axis: normalizeMetric(data.prescription && data.prescription.left && data.prescription.left.axis)
            },
            pd: normalizeMetric(data.prescription && data.prescription.pd)
          },
          tint_info: presetTint,
          lens_material: presetTint ? presetTint.name : data.lensMaterial || '',
          tintSurchargeYuan: presetTint ? presetTint.surchargeYuan : 0
        };

        this.setData({
          loading: false,
          order,
          tintInfo: presetTint
        });
      })
      .catch((err) => {
        this.setData({
          loading: false,
          error: err.message || '加载订单失败'
        });
      });
  },

  openLensTintPage() {
    const order = this.data.order;
    if (!order) return;

    wx.navigateTo({
      url: `/pages/lens-tint/index?mode=picker&selectedTintId=${encodeURIComponent((order.tint_info && order.tint_info.id) || '')}`,
      success: (res) => {
        res.eventChannel.on('lensTintSelected', (selectedTint) => {
          if (!selectedTint || !selectedTint.id) return;
          this.applySelectedTint(selectedTint);
        });
      }
    });
  },

  applySelectedTint(selectedTint) {
    const currentOrder = this.data.order;
    if (!currentOrder) return;

    const normalizedTint = {
      id: selectedTint.id,
      name: selectedTint.name || selectedTint.id,
      hex: selectedTint.hex || '',
      surchargeYuan: Number.isFinite(Number(selectedTint.surchargeYuan))
        ? Math.max(0, Number(selectedTint.surchargeYuan))
        : 0
    };

    const lensTypePrefix = currentOrder.lensType ? `${currentOrder.lensType}` : '镜片';
    const nextOrder = {
      ...currentOrder,
      tint_info: normalizedTint,
      lens_material: normalizedTint.name,
      tintSurchargeYuan: normalizedTint.surchargeYuan,
      lensType: `${lensTypePrefix} / 染色:${normalizedTint.name}`
    };

    this.setData({
      order: nextOrder,
      tintInfo: normalizedTint
    });

    this.syncTintToCloud(nextOrder, normalizedTint);

    wx.showToast({
      title: `已选择 ${normalizedTint.name}`,
      icon: 'none'
    });
  },

  syncTintToCloud(order, tintInfo) {
    if (!order || !tintInfo || !tintInfo.name) return;
    request({
      url: '/api/miniprogram/order-detail',
      method: 'PUT',
      data: {
        orderId: order.id || '',
        orderNo: order.orderNo || '',
        tint: {
          id: tintInfo.id,
          name: tintInfo.name,
          hex: tintInfo.hex
        }
      },
      showLoading: false
    }).catch(() => {
      // 忽略同步失败，不阻塞本地回填流程
    });
  }
});
