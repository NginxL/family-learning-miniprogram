import type { CalendarDate, ChildProfile } from './models';

function validCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// Both dates are calendar dates in Shanghai time. Age changes on the birthday,
// independently of elapsed hours, device timezone, school grade or learning progress.
function ageFromBirthDate(birthDate: unknown, today: unknown): number | null {
  if (!validCalendarDate(birthDate) || !validCalendarDate(today) || birthDate > today) return null;
  return Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
    - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
}

function withCurrentAge<T extends Pick<ChildProfile, 'birthDate' | 'age' | 'ageRecordedOn'>>(child: T, today: CalendarDate): T {
  const age = ageFromBirthDate(child.birthDate, today);
  return age === null ? { ...child } : { ...child, age, ageRecordedOn: today };
}

export { ageFromBirthDate, withCurrentAge };
