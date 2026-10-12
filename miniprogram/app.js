const { SyncEngine } = require('./lib/sync-engine');
const config = require('./config');
App({
  onLaunch() {
    let transport;
    if (config.mode === 'demo') transport = require('./lib/demo').createDemo(wx);
    else {
      if (wx.cloud && config.envId) wx.cloud.init({ env: config.envId, traceUser: false });
      transport = async (action, payload) => {
        if (!wx.cloud || !config.envId) throw new Error('云开发尚未配置，请设置环境 ID');
        const response = await wx.cloud.callFunction({ name: 'familyApi', data: { action, payload } });
        const result = response.result;
        if (!result || !result.ok) {
          const error = new Error(result && result.error ? result.error.message : '云函数返回异常');
          error.code = result && result.error && result.error.code;
          throw error;
        }
        return result.data;
      };
    }
    const key = `family-learning-v1:${config.mode}:${config.envId}`;
    this.engine = new SyncEngine({ transport, storage: {
      read: () => wx.getStorageSync(key) || null,
      write: (data) => wx.setStorageSync(key, data)
    } });
    this.mode = config.mode;
    this.networkListener = ({ isConnected }) => { if (isConnected) this.engine.sync(); };
    wx.onNetworkStatusChange(this.networkListener);
  },
  onShow() { if (this.engine) this.engine.sync(); }
});
