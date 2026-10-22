import type { ApiAction, ApiPayloads } from '../../shared/api';
import type { Day, Task } from '../../shared/models';
import type { CacheActions, CacheBodies, CacheBucket, Cached, ClientResults, ClientTransport, CommandPayloads, SyncOptions, SyncSnapshot, SyncState, SyncStatus, SyncStorage } from './client-models';
import { errorDetails } from './errors';
import { catalogById } from './learning/learning';
const empty = (): SyncState => ({ userId: null, family: null, days: {}, histories: {}, progresses: {}, learningStatuses: {}, queue: [], notice: '' });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const dayKey = (familyId: string, date: string) => `${familyId}:${date}`;
const chinaDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

class SyncEngine {
  readonly transport: ClientTransport;
  readonly storage: SyncStorage;
  readonly makeId: () => string;
  state: SyncState;
  readonly listeners: Set<() => void>;
  status: SyncStatus;
  error: string;
  today: string;
  running?: Promise<void> | null;
  lastDate?: string;
  constructor({ transport, storage, makeId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2)}` }: SyncOptions) {
    this.transport = transport;
    this.storage = storage;
    this.makeId = makeId;
    this.state = storage.read() || empty();
    this.listeners = new Set();
    this.status = 'idle';
    this.error = '';
    this.today = chinaDate();
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { this.listeners.forEach((listener) => listener()); }
  save(next: SyncState) { this.storage.write(next); this.state = next; this.emit(); }
  snapshot(): SyncSnapshot { return { ...clone(this.state), today: this.today, status: this.status, error: this.error }; }
  viewDay(date: string): Day {
    if (!this.state.family) return { date, tasks: [] };
    const key = dayKey(this.state.family.id, date);
    const day: Day = clone(this.state.days[key] || { date, tasks: [] });
    this.state.queue.filter((entry) => entry.familyId === this.state.family!.id && entry.date === date).forEach((entry) => {
      const task = day.tasks.find((item) => item.id === entry.taskId);
      if (task) Object.assign(task, { done: entry.done, version: entry.baseVersion + 1, pending: true });
    });
    return day;
  }
  enqueue(date: string, taskId: string, done: boolean) {
    return this.enqueueMany(date, [taskId], done);
  }
  enqueueMany(date: string, taskIds: string[], done: boolean) {
    if (this.state.family?.myRole === 'child') throw Object.assign(new Error('请提交作业，由家长确认完成'), { code: 'PARENT_REQUIRED' });
    if (!this.state.userId || !this.state.family) throw new Error('请先联网加载学习档案');
    if (date > this.today) throw new Error('未来的学习安排暂不能完成');
    if (!Array.isArray(taskIds) || typeof done !== 'boolean') throw new Error('学习记录无效，请刷新后重试');
    const day = this.viewDay(date);
    const tasks = [...new Set(taskIds)].map((id) => day.tasks.find((task) => task.id === id));
    if (!tasks.every((task): task is Task => Boolean(task))) throw new Error('请先联网加载当天任务');
    const changed = tasks.filter((task) => task.done !== done);
    if (!changed.length) return 0;
    if (this.state.queue.length + changed.length > 500) throw new Error('待同步记录较多，请先联网同步');
    const next = clone(this.state);
    changed.forEach((task) => next.queue.push({ familyId: next.family!.id, date, taskId: task.id, done, baseVersion: task.version, mutationId: this.makeId() }));
    // Validate and persist the whole local group before displaying any successful check-ins.
    this.save(next);
    return changed.length;
  }
  async bootstrap() {
    const data = await this.transport('bootstrap', { ensureDefault: true });
    const next = clone(this.state);
    const oldFamily = next.family && next.family.id;
    const newFamily = data.family && data.family.id;
    if (next.userId !== data.userId || oldFamily !== newFamily
      || next.family?.myRole !== data.family?.myRole || next.family?.myChildId !== data.family?.myChildId) {
      Object.assign(next, empty());
    }
    next.userId = data.userId;
    next.family = data.family;
    if (data.family?.myRole === 'child' && next.queue.length) { next.queue = []; next.notice = '孩子账号只能提交作业，完成记录由家长确认。'; }
    this.today = data.today;
    this.save(next);
  }
  async command<A extends ApiAction>(action: A, payload: CommandPayloads[A]): Promise<ClientResults[A]> {
    // Membership/plan writes require a connection; only check-ins are queued offline.
    // Keep the v1 null-family request path: the service rejects writes without membership.
    if (this.state.family?.myRole === 'child' && !['uploadHomeworkAttachment', 'submitHomework', 'getHomework', 'getHomeworkAttachment'].includes(action))
      throw Object.assign(new Error('此操作需要家长确认'), { code: 'PARENT_REQUIRED' });
    if ((action === 'saveDailyTemplate' || action === 'saveAutoPlans') && this.state.family?.recitationPlanningVersion !== 1
      && (payload as CommandPayloads['saveDailyTemplate']).rules?.some(rule => rule.recitationPolicy && rule.recitationPolicy !== 'all'))
      throw Object.assign(new Error('教材必背安排等待服务更新；当前模板未修改。可在本机演示版体验。'), { code: 'UNSUPPORTED' });
    if ((action === 'assignContent' || action === 'reviewContent') && (catalogById.get((payload as CommandPayloads['assignContent']).contentId)?.minimumServiceVersion || 0) > (this.state.family?.recitationPlanningVersion || 0))
      throw Object.assign(new Error('这项新内容等待服务更新；当前学习记录未修改。可在本机演示版安排。'), { code: 'UNSUPPORTED' });
    if (['saveDailyTemplate', 'activateDailyTemplate', 'saveTemplateSchedule'].includes(action)
      && (payload as CommandPayloads['saveDailyTemplate']).applyToday) {
      const session = JSON.stringify([this.state.userId, this.state.family?.id, this.state.family?.myRole]);
      await this.sync();
      if (this.status !== 'online' || this.state.queue.length) throw new Error('请先联网同步学习记录，再更新今日安排');
      if (session !== JSON.stringify([this.state.userId, this.state.family?.id, this.state.family?.myRole])) throw new Error('家庭身份已变化，请重新打开模板');
      if (this.state.family?.templateTodayVersion !== 1) throw Object.assign(new Error('今日安排等待服务更新，模板尚未修改'), { code: 'UNSUPPORTED' });
    }
    const input = { ...payload, familyId: this.state.family && this.state.family.id } as ApiPayloads[A];
    const data = await this.transport(action, input);
    await this.sync();
    return data;
  }
  async getHistory(input: CommandPayloads['getHistory']) {
    return this.cachedRead('getHistory', 'histories', input, [input.subject, input.filter, input.query, input.offset || 0], 8);
  }
  async getProgress(input: CommandPayloads['getProgress']) {
    return this.cachedRead('getProgress', 'progresses', input, [], 5);
  }
  async getLearningStatus(input: CommandPayloads['getLearningStatus']) {
    return this.cachedRead('getLearningStatus', 'learningStatuses', input, [], 5);
  }
  private cachedRead(action: 'getHistory', bucket: 'histories', input: CommandPayloads['getHistory'], fields: unknown[], max: number): Promise<Cached<ClientResults['getHistory']>>;
  private cachedRead(action: 'getProgress', bucket: 'progresses', input: CommandPayloads['getProgress'], fields: unknown[], max: number): Promise<Cached<ClientResults['getProgress']>>;
  private cachedRead(action: 'getLearningStatus', bucket: 'learningStatuses', input: CommandPayloads['getLearningStatus'], fields: unknown[], max: number): Promise<Cached<ClientResults['getLearningStatus']>>;
  private async cachedRead(action: CacheActions[CacheBucket], bucket: CacheBucket, input: CommandPayloads['getHistory'], fields: unknown[], max: number): Promise<Cached<CacheBodies[CacheBucket]>> {
    const familyId = this.state.family && this.state.family.id;
    const userId = this.state.userId;
    const role = this.state.family?.myRole; const boundChild = this.state.family?.myChildId;
    const sameSession = () => this.state.userId === userId && this.state.family?.id === familyId
      && this.state.family?.myRole === role && this.state.family?.myChildId === boundChild;
    if (!familyId) throw new Error('请先联网加载学习档案');
    const key = JSON.stringify([familyId, input.childId, ...fields]);
    try {
      const result = await this.transport(action, { ...input, familyId } as ApiPayloads[CacheActions[CacheBucket]]);
      if (!sameSession()) throw new Error('家庭或身份已切换，请刷新');
      const next = clone(this.state);
      // The overloads pair each API action with its own cache bucket.
      const cache: Record<string, CacheBodies[CacheBucket]> = next[bucket] || (next[bucket] = {});
      delete cache[key]; cache[key] = result;
      Object.keys(cache).slice(0, -max).forEach((old) => delete cache[old]);
      this.save(next); return { ...result, cached: false };
    } catch (cause) {
      const error = errorDetails(cause);
      if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED') {
        if (sameSession()) this.save(empty());
        throw cause;
      }
      const cached = this.state[bucket] && this.state[bucket][key];
      if (cached && sameSession()) return { ...clone(cached), cached: true };
      throw cause;
    }
  }
  sync(date = chinaDate()): Promise<void> {
    if (this.running) {
      // A date change while a refresh is in flight must still fetch the requested day.
      return this.running.then(() => this.lastDate === date ? undefined : this.sync(date));
    }
    this.running = this.runSync(date).finally(() => { this.running = null; });
    return this.running;
  }
  async runSync(date: string): Promise<void> {
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
        } catch (cause) {
          const error = errorDetails(cause);
          if (['CONFLICT', 'NOT_FOUND', 'INVALID'].includes(error.code || '')) {
            const next = clone(this.state);
            next.queue = next.queue.filter((item) => !(item.familyId === entry.familyId && item.date === entry.date && item.taskId === entry.taskId));
            next.notice = error.code === 'CONFLICT' ? '有任务已被家人更新，已保留云端结果。请查看后重新确认。' : '有记录未被服务器接受，请查看任务后重新操作。';
            this.save(next);
          } else { throw cause; }
        }
      }
      for (const target of affectedDates) {
        const { day, today } = await this.transport('getDay', { familyId: this.state.family.id, date: target });
        const next = clone(this.state);
        next.days[dayKey(next.family!.id, target)] = day;
        // Cache 30 days locally; authoritative data remains in CloudBase.
        const keys = Object.keys(next.days).sort().reverse();
        keys.slice(30).forEach((key) => delete next.days[key]);
        this.today = today;
        this.save(next);
      }
      this.lastDate = date;
      this.status = 'online';
    } catch (cause) {
      const error = errorDetails(cause);
      if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED') this.save(empty());
      this.status = 'offline';
      this.error = error.message || '暂时无法连接，联网后会继续同步';
    } finally { this.emit(); }
  }
  dismissNotice() { const next = clone(this.state); next.notice = ''; this.save(next); }
}
export { SyncEngine, chinaDate, shiftDate };
