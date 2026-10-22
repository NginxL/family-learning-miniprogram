import { SyncEngine } from './lib/sync-engine';
import type { ClientTransport, LearningApp, SyncState } from './lib/client-models';
import { createCloudTransport } from './lib/cloud-transport';
import config = require('./config');
import type { createDemo } from './lib/demo';
App<Partial<LearningApp>>({
  onLaunch(this: LearningApp) {
    let transport: ClientTransport;
    if (config.mode === 'demo') transport = (require('./lib/demo') as { createDemo: typeof createDemo }).createDemo(wx);
    else {
      if (wx.cloud && config.envId) wx.cloud.init({ env: config.envId, traceUser: false });
      transport = createCloudTransport(wx.cloud, config.envId, config.speechFunction);
    }
    const key = `family-learning-v1:${config.mode}:${config.envId}`;
    this.engine = new SyncEngine({ transport, storage: {
      // v1 storage is an app-owned JSON boundary; keep the existing key and shape.
      read: () => (wx.getStorageSync(key) || null) as SyncState | null,
      write: (data) => wx.setStorageSync(key, data)
    } });
    this.mode = config.mode;
    this.networkListener = ({ isConnected }) => { if (isConnected) this.engine.sync(); };
    wx.onNetworkStatusChange(this.networkListener);
  },
  onShow(this: LearningApp) { if (this.engine) this.engine.sync(); }
});
