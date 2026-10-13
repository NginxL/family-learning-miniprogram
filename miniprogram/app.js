const { SyncEngine } = require('./lib/sync-engine');
const { createCloudTransport } = require('./lib/cloud-transport');
const config = require('./config');
App({
  onLaunch() {
    let transport;
    if (config.mode === 'demo') transport = require('./lib/demo').createDemo(wx);
    else {
      if (wx.cloud && config.envId) wx.cloud.init({ env: config.envId, traceUser: false });
      transport = createCloudTransport(wx.cloud, config.envId);
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
