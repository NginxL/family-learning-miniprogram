'use strict';
const empty = () => ({ userId: null, family: null, days: {}, histories: {}, progresses: {}, queue: [], notice: '' });
const clone = (value) => JSON.parse(JSON.stringify(value));
const dayKey = (familyId, date) => `${familyId}:${date}`;
const chinaDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

class SyncEngine {
  constructor({ transport, storage, makeId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2)}` }) {
    this.transport = transport;
    this.storage = storage;
    this.makeId = makeId;
    this.state = storage.read() || empty();
    this.listeners = new Set();
    this.status = 'idle';
    this.error = '';
    this.today = chinaDate();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { this.listeners.forEach((listener) => listener()); }
  save(next) { this.storage.write(next); this.state = next; this.emit(); }
  snapshot() { return { ...clone(this.state), today: this.today, status: this.status, error: this.error }; }
  viewDay(date) {
    if (!this.state.family) return { date, tasks: [] };
    const key = dayKey(this.state.family.id, date);
    const day = clone(this.state.days[key] || { date, tasks: [] });
    this.state.queue.filter((entry) => entry.familyId === this.state.family.id && entry.date === date).forEach((entry) => {
      const task = day.tasks.find((item) => item.id === entry.taskId);
      if (task) Object.assign(task, { done: entry.done, version: entry.baseVersion + 1, pending: true });
    });
    return day;
  }
  enqueue(date, taskId, done) {
    return this.enqueueMany(date, [taskId], done);
  }
  enqueueMany(date, taskIds, done) {
    if (!this.state.userId || !this.state.family) throw new Error('请先联网加载学习档案');
    if (!Array.isArray(taskIds) || typeof done !== 'boolean') throw new Error('学习记录无效，请刷新后重试');
    const day = this.viewDay(date);
    const tasks = [...new Set(taskIds)].map((id) => day.tasks.find((task) => task.id === id));
    if (tasks.some((task) => !task)) throw new Error('请先联网加载当天任务');
    const changed = tasks.filter((task) => task.done !== done);
    if (!changed.length) return 0;
    if (this.state.queue.length + changed.length > 500) throw new Error('待同步记录较多，请先联网同步');
    const next = clone(this.state);
    changed.forEach((task) => next.queue.push({ familyId: next.family.id, date, taskId: task.id, done, baseVersion: task.version, mutationId: this.makeId() }));
    // Validate and persist the whole local group before displaying any successful check-ins.
    this.save(next);
    return changed.length;
  }
  async bootstrap() {
    const data = await this.transport('bootstrap', { ensureDefault: true });
    const next = clone(this.state);
    const oldFamily = next.family && next.family.id;
    const newFamily = data.family && data.family.id;
    if (next.userId !== data.userId || oldFamily !== newFamily) {
      Object.assign(next, empty());
    }
    next.userId = data.userId;
    next.family = data.family;
    this.today = data.today;
    this.save(next);
  }
  async command(action, payload) {
    // Membership/plan writes require a connection; only check-ins are queued offline.
    const data = await this.transport(action, { ...payload, familyId: this.state.family && this.state.family.id });
    await this.sync();
    return data;
  }
  async getHistory(input) {
    return this.cachedRead('getHistory', 'histories', input, [input.subject, input.filter, input.query, input.offset || 0], 8);
  }
  async getProgress(input) {
    return this.cachedRead('getProgress', 'progresses', input, [], 5);
  }
  async cachedRead(action, bucket, input, fields, max) {
    const familyId = this.state.family && this.state.family.id;
    const userId = this.state.userId;
    if (!familyId) throw new Error('请先联网加载学习档案');
    const key = JSON.stringify([familyId, input.childId, ...fields]);
    try {
      const result = await this.transport(action, { ...input, familyId });
      if (this.state.userId !== userId || !this.state.family || this.state.family.id !== familyId) throw new Error('家庭已切换，请刷新');
      const next = clone(this.state); next[bucket] = next[bucket] || {};
      delete next[bucket][key]; next[bucket][key] = result;
      Object.keys(next[bucket]).slice(0, -max).forEach((old) => delete next[bucket][old]);
      this.save(next); return { ...result, cached: false };
    } catch (error) {
      if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED') {
        if (this.state.userId === userId && this.state.family && this.state.family.id === familyId) this.save(empty());
        throw error;
      }
      const cached = this.state[bucket] && this.state[bucket][key];
      if (cached && this.state.userId === userId && this.state.family && this.state.family.id === familyId) return { ...clone(cached), cached: true };
      throw error;
    }
  }
  sync(date = chinaDate()) {
    if (this.running) {
      // A date change while a refresh is in flight must still fetch the requested day.
      return this.running.then(() => this.lastDate === date ? undefined : this.sync(date));
    }
    this.running = this.runSync(date).finally(() => { this.running = null; });
    return this.running;
  }
  async runSync(date) {
    this.status = 'syncing'; this.error = ''; this.emit();
    try {
      await this.bootstrap();
      if (!this.state.family) { this.status = 'online'; this.lastDate = date; return; }
      const affectedDates = new Set([date]);
      while (this.state.queue.length) {
        const entry = this.state.queue[0];
        affectedDates.add(entry.date);
        try {
          const result = await this.transport('setTaskDone', entry);
          const next = clone(this.state);
          next.queue = next.queue.filter((item) => item.mutationId !== entry.mutationId);
          const cached = next.days[dayKey(entry.familyId, entry.date)];
          const index = cached ? cached.tasks.findIndex((task) => task.id === entry.taskId) : -1;
          if (index >= 0 && cached.tasks[index].version <= result.task.version) cached.tasks[index] = result.task;
          this.save(next);
        } catch (error) {
          if (['CONFLICT', 'NOT_FOUND', 'INVALID'].includes(error.code)) {
            const next = clone(this.state);
            next.queue = next.queue.filter((item) => !(item.familyId === entry.familyId && item.date === entry.date && item.taskId === entry.taskId));
            next.notice = error.code === 'CONFLICT' ? '有任务已被家人更新，已保留云端结果。请查看后重新确认。' : '有记录未被服务器接受，请查看任务后重新操作。';
            this.save(next);
          } else { throw error; }
        }
      }
      for (const target of affectedDates) {
        const { day, today } = await this.transport('getDay', { familyId: this.state.family.id, date: target });
        const next = clone(this.state);
        next.days[dayKey(next.family.id, target)] = day;
        // Cache 30 days locally; authoritative data remains in CloudBase.
        const keys = Object.keys(next.days).sort().reverse();
        keys.slice(30).forEach((key) => delete next.days[key]);
        this.today = today;
        this.save(next);
      }
      this.lastDate = date;
      this.status = 'online';
    } catch (error) {
      if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED') this.save(empty());
      this.status = 'offline';
      this.error = error.message || '暂时无法连接，联网后会继续同步';
    } finally { this.emit(); }
  }
  dismissNotice() { const next = clone(this.state); next.notice = ''; this.save(next); }
}
module.exports = { SyncEngine, chinaDate };
