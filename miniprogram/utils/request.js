const CONFIG = {
  BASE_URL: 'https://opti-ai.cn',
  OSS_BASE: 'https://opti-ai.cn'
};
const TOKEN_STORAGE_KEY = 'token';
const LEGACY_TOKEN_STORAGE_KEY = 'NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN';
const DEFAULT_TIMEOUT = 15000;
const LOGIN_PAGE = '/pages/index/index';
const RETRY_WHITELIST = ['/api/ai/'];
const MAX_RETRY_COUNT = 2;

let loadingCount = 0;
let isAuthRedirecting = false;

function getToken() {
  return wx.getStorageSync(TOKEN_STORAGE_KEY) || wx.getStorageSync(LEGACY_TOKEN_STORAGE_KEY) || '';
}

function setToken(token) {
  if (!token) {
    return;
  }

  wx.setStorageSync(TOKEN_STORAGE_KEY, token);
  wx.setStorageSync(LEGACY_TOKEN_STORAGE_KEY, token);
}

function clearToken() {
  wx.removeStorageSync(TOKEN_STORAGE_KEY);
  wx.removeStorageSync(LEGACY_TOKEN_STORAGE_KEY);
}

function showGlobalLoading() {
  if (loadingCount === 0) {
    wx.showLoading({
      title: '加载中',
      mask: true
    });
  }
  loadingCount += 1;
}

function hideGlobalLoading() {
  if (loadingCount <= 0) {
    return;
  }

  loadingCount -= 1;
  if (loadingCount === 0) {
    wx.hideLoading();
  }
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || '').replace(/\/+$/, '');
}

function buildUrl(url) {
  if (!url) {
    return CONFIG.BASE_URL;
  }

  if (/^https?:\/\//.test(url)) {
    return url;
  }

  return `${normalizeBaseUrl(CONFIG.BASE_URL)}${url.startsWith('/') ? '' : '/'}${url}`;
}

function buildHeaders(customHeader = {}) {
  const token = getToken();
  const headers = Object.assign(
    {
      'Content-Type': 'application/json'
    },
    customHeader
  );

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function isWhitelistedForRetry(url) {
  return RETRY_WHITELIST.some((prefix) => url.indexOf(prefix) === 0 || buildUrl(url).indexOf(buildUrl(prefix)) === 0);
}

function isImageLikeField(key) {
  return /(image|img|avatar|photo|picture|cover|thumb|url|path)/i.test(key || '');
}

function isImageLikeValue(value) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(value || '');
}

function prependOssBase(path) {
  if (!path || /^https:\/\//i.test(path) || /^data:/i.test(path)) {
    return path;
  }

  const base = normalizeBaseUrl(CONFIG.OSS_BASE);
  if (!base) {
    return path;
  }

  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function normalizeOssUrls(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeOssUrls(item));
  }

  if (payload && typeof payload === 'object') {
    const next = {};
    Object.keys(payload).forEach((key) => {
      const value = payload[key];
      if (typeof value === 'string' && (isImageLikeField(key) || isImageLikeValue(value))) {
        next[key] = prependOssBase(value);
        return;
      }
      next[key] = normalizeOssUrls(value);
    });
    return next;
  }

  return payload;
}

function redirectToLogin() {
  if (isAuthRedirecting) {
    return;
  }

  isAuthRedirecting = true;
  wx.reLaunch({
    url: LOGIN_PAGE,
    complete: () => {
      setTimeout(() => {
        isAuthRedirecting = false;
      }, 500);
    }
  });
}

function createHttpError(response) {
  const { statusCode, data } = response;
  return {
    statusCode,
    data,
    message: (data && data.message) || 'Request failed'
  };
}

function handleUnauthorized() {
  clearToken();
  redirectToLogin();
}

function normalizeResponse(response) {
  const { statusCode } = response;
  const normalizedData = normalizeOssUrls(response.data);

  if (statusCode >= 200 && statusCode < 300) {
    return normalizedData;
  }

  if (statusCode === 401) {
    handleUnauthorized();
  }

  throw createHttpError({
    statusCode,
    data: normalizedData
  });
}

function requestWithRetry(taskFn, options, retryCount = 0) {
  return taskFn(options).catch((error) => {
    const canRetry = !!error.isNetworkError && isWhitelistedForRetry(options.url) && retryCount < MAX_RETRY_COUNT;
    if (!canRetry) {
      throw error;
    }
    return requestWithRetry(taskFn, options, retryCount + 1);
  });
}

function request(options = {}) {
  const {
    url,
    method = 'GET',
    data = {},
    header = {},
    timeout = DEFAULT_TIMEOUT,
    showLoading = true
  } = options;

  const run = () =>
    new Promise((resolve, reject) => {
      wx.request({
        url: buildUrl(url),
        method,
        data,
        timeout,
        header: buildHeaders(header),
        success: (response) => {
          try {
            const normalized = normalizeResponse(response);
            resolve(normalized);
          } catch (error) {
            reject(error);
          }
        },
        fail: (error) => {
          reject({
            isNetworkError: true,
            message: error.errMsg || 'Network error',
            error
          });
        }
      });
    });

  if (showLoading) {
    showGlobalLoading();
  }

  return requestWithRetry(run, { url })
    .finally(() => {
      if (showLoading) {
        hideGlobalLoading();
      }
    });
}

function uploadFile(options = {}) {
  const {
    url,
    filePath,
    name = 'file',
    formData = {},
    header = {},
    timeout = DEFAULT_TIMEOUT,
    showLoading = true
  } = options;

  const run = () =>
    new Promise((resolve, reject) => {
      wx.uploadFile({
        url: buildUrl(url),
        filePath,
        name,
        formData,
        timeout,
        header: buildHeaders(header),
        success: (response) => {
          let parsedData = response.data;
          try {
            parsedData = JSON.parse(response.data);
          } catch (e) {
            // Keep raw string if backend does not return JSON.
          }

          try {
            const normalized = normalizeResponse({
              statusCode: response.statusCode,
              data: parsedData
            });
            resolve(normalized);
          } catch (error) {
            reject(error);
          }
        },
        fail: (error) => {
          reject({
            isNetworkError: true,
            message: error.errMsg || 'Upload failed',
            error
          });
        }
      });
    });

  if (showLoading) {
    showGlobalLoading();
  }

  return requestWithRetry(run, { url })
    .finally(() => {
      if (showLoading) {
        hideGlobalLoading();
      }
    });
}

module.exports = {
  CONFIG,
  TOKEN_STORAGE_KEY,
  LEGACY_TOKEN_STORAGE_KEY,
  RETRY_WHITELIST,
  request,
  uploadFile,
  getToken,
  setToken,
  clearToken
};
