'use strict';
const cloud = require('wx-server-sdk');
const { createService } = require('./service');
const { createCloudStore } = require('./store');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const service = createService({ store: createCloudStore(cloud.database({ throwOnNotFound: false })) });

exports.main = async (event) => {
  try {
    // The caller identity comes exclusively from WeChat, never from event data.
    const { OPENID } = cloud.getWXContext();
    const data = await service.execute(OPENID, event && event.action, event && event.payload);
    return { ok: true, data };
  } catch (error) {
    if (error.code && error.isDomainError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    console.error('familyApi failed', { code: error.errCode || error.code || 'UNKNOWN' });
    return { ok: false, error: { code: 'UNAVAILABLE', message: '服务暂时不可用，请稍后重试' } };
  }
};
