const { common } = require('../../lib/page');
const { gradeLabels } = require('../../lib/learning/learning');
const base = common();
Page({
  ...base,
  data: { ...base.data, progress: null, progressBusy: false, progressError: '', progressCached: false },
  afterRender() {
    const key = `${this.data.family && this.data.family.id}:${this.data.childId}`;
    if (key !== this.progressKey) { this.progressKey = key; this.setData({ progress: null, progressError: '' }); }
  },
  afterSync() { return this.loadProgress(); },
  selectionChanged() { return this.loadProgress(); },
  browseGrade(event) {
    this.rememberSelection(); getApp().navigation.libraryGrade = Number(event.currentTarget.dataset.grade);
    wx.switchTab({ url: '/pages/library/index' });
  },
  async loadProgress() {
    if (!this.data.family || !this.data.childId) return;
    const key = this.progressKey;
    const request = (this.progressRequest || 0) + 1; this.progressRequest = request;
    this.setData({ progressBusy: true, progressError: '' });
    try {
      const result = await this.engine.getProgress({ childId: this.data.childId });
      if (!this.active || key !== this.progressKey || this.progressRequest !== request) return;
      this.setData({ progress: result, progressCached: result.cached, highestLabel: gradeLabels[result.highestGradeStarted] });
    } catch (error) {
      if (this.active && key === this.progressKey && this.progressRequest === request) this.setData({ progressError: error.message || '知识进度加载失败' });
    } finally { if (this.progressRequest === request) this.setData({ progressBusy: false }); }
  },
  cleanup() { base.cleanup.call(this); this.progressRequest = (this.progressRequest || 0) + 1; }
});
