const { request } = require('./request');

function dispatchDeviceCommand(payload = {}) {
  return request({
    url: '/api/miniprogram/device/dispatch',
    method: 'POST',
    data: payload
  });
}

module.exports = {
  dispatchDeviceCommand
};
