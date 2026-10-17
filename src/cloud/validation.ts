import crypto = require('node:crypto');
import type { LearningLedger } from '../shared/models';
// Application guard, not the provider's limit. Keep writes bounded without
// changing the v1 ledger shape or discarding earlier completion dates.
const LEDGER_MAX_BYTES = 1024 * 1024;
function requireLedgerCapacity(ledger: LearningLedger): void {
  requireValue(Buffer.byteLength(JSON.stringify(ledger), 'utf8') < LEDGER_MAX_BYTES,
    'LIMIT', '学习档案容量已满，请联系管理员扩容后重试');
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const chinaDate = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
class DomainError extends Error {
  code: string;
  isDomainError: boolean;
  constructor(code: string, message: string) { super(message); this.code = code; this.isDomainError = true; }
}
function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
function text(value: unknown, label: string, max = 40): string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    'INVALID', `${label}不能为空，且不能超过${max}字`);
  return value.trim();
}
function identifier(value: unknown): string {
  requireValue(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value), 'INVALID', '编号无效');
  return value;
}
function validDate(value: unknown, now: number): string {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID', '日期无效');
  const parsed = Date.parse(`${value}T00:00:00+08:00`);
  requireValue(Number.isFinite(parsed) && chinaDate(parsed) === value && value <= chinaDate(now), 'INVALID', '日期无效或尚未到达');
  requireValue(now - parsed <= 366 * 86400000, 'INVALID', '仅支持最近一年内的记录');
  return value;
}
// Scheduling is separate from check-ins: future dates must never pass validDate.
function planningDate(value: unknown, now: number): string {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID', '日期无效');
  const parsed = Date.parse(`${value}T00:00:00+08:00`);
  const today = chinaDate(now);
  requireValue(Number.isFinite(parsed) && chinaDate(parsed) === value && value >= today
    && parsed - Date.parse(`${today}T00:00:00+08:00`) <= 365 * 86400000,
  'INVALID', '请选择今日起一年内的日期');
  return value;
}
export { DomainError, requireValue, requireLedgerCapacity, LEDGER_MAX_BYTES, text, identifier, validDate, planningDate, hash, chinaDate };
