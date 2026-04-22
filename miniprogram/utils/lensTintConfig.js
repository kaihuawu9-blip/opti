const { request } = require('./request');

const CACHE_KEY = 'lens_tint_config_v1';
const CACHE_TTL_MS = 60 * 1000;

function loadCache() {
  try {
    const data = wx.getStorageSync(CACHE_KEY);
    if (!data || typeof data !== 'object') return null;
    const expiresAt = Number(data.expiresAt || 0);
    if (!expiresAt || Date.now() > expiresAt) return null;
    if (!Array.isArray(data.colors) || data.colors.length === 0) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function saveCache(config) {
  try {
    wx.setStorageSync(CACHE_KEY, {
      source: config.source,
      version: config.version,
      updatedAt: config.updatedAt,
      colors: config.colors,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
  } catch (e) {
    // ignore cache write error
  }
}

function normalizeColors(colors) {
  if (!Array.isArray(colors)) return [];
  return colors
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const id = String(item.id || `tint-${index + 1}`).trim();
      const name = String(item.name || id || '').trim();
      const hex = String(item.hex || '').trim();
      const surchargeYuan = Number(item.surchargeYuan);
      if (!id || !name || !hex) return null;
      return {
        ...item,
        id,
        name,
        hex,
        surchargeYuan: Number.isFinite(surchargeYuan) ? Math.max(0, surchargeYuan) : 0
      };
    })
    .filter(Boolean);
}

/**
 * 小程序端读取镜片染色配置（云端优先）。
 * 后续新增颜色只需更新云端配置，不需要改小程序代码。
 */
async function fetchLensTintConfig(options = {}) {
  const { forceRefresh = false } = options;
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached) return cached;
  }

  const data = await request({
    url: '/api/lens/tint-colors/',
    method: 'GET',
    showLoading: false
  });

  const config = {
    source: data.source || 'builtin',
    version: data.version || 'unknown',
    updatedAt: data.updatedAt || '',
    colors: normalizeColors(data.colors)
  };
  if (!config.colors.length) {
    throw new Error('镜片颜色配置为空');
  }
  saveCache(config);
  return config;
}

module.exports = {
  fetchLensTintConfig
};

