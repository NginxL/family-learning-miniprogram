import { kinds } from './learning/learning';
import type { HomeworkScope } from '../../shared/models';
export type TaskRouteQuery = Record<string, string | undefined>;
export function parseTaskRoute(query: TaskRouteQuery, latestDate: string): HomeworkScope | null {
  const { familyId, childId, date, kind } = query;
  const validId = (value: string | undefined): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  if (!validId(familyId) || !validId(childId) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > latestDate) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return null;
  const definition = kinds.find((item) => item.id === kind);
  return definition ? { familyId, childId, date, kind: definition.id } : null;
}
