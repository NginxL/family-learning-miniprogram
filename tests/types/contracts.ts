// Compile-only consumer tests. An unused @ts-expect-error fails typecheck too.
import type { ApiEnvelope, ApiRequest, ApiTransport, FamilyService } from '../../src/shared/api';
import type { KnowledgeItem, LearningRecord, SchoolGrade, Transaction } from '../../src/shared/models';
import { recordTasks } from '../../src/shared/learning';

declare const transport: ApiTransport;
declare const service: FamilyService;
declare const tx: Transaction;
declare const knowledge: KnowledgeItem;
declare const record: LearningRecord;

async function validConsumers() {
  const history = await transport('getHistory', { familyId: 'family', childId: 'child', filter: 'learned' });
  const count: number = history.total;
  const date: string = history.items[0].lastLearned;
  const day = await service.execute('wechat-context-identity', 'getDay', { familyId: 'family' });
  recordTasks({ records: {} }, day.day.tasks, day.today);
  const ledger = await tx.get('learning', 'ledger');
  const mastered: boolean | undefined = ledger?.records['item'].mastered;
  return { count, date, mastered };
}
void validConsumers;

// @ts-expect-error Grade labels cannot be stored as the numeric school grade.
const wrongGrade: SchoolGrade = '一年级';
// @ts-expect-error Ten is outside the supported school grades.
const invalidGrade: SchoolGrade = 10;
// @ts-expect-error Misspelled content kinds must not silently reach the planner.
const wrongKind: KnowledgeItem = { ...knowledge, kind: 'words' };
// @ts-expect-error Completion history is an array of dates, not a single string.
const wrongRecord: LearningRecord = { ...record, completedDates: '2026-10-13' };
// @ts-expect-error A completion count must not be used as the mastery flag.
const wrongMastery: LearningRecord = { ...record, mastered: 1 };
// @ts-expect-error Changing a task requires the expected version and mutation ID.
transport('setTaskDone', { familyId: 'family', date: '2026-10-13', taskId: 'task', done: true });
// @ts-expect-error Requests cannot mix getDay with a setMastery payload.
const mixedRequest: ApiRequest = { action: 'getDay', payload: { familyId: 'family', childId: 'child', contentId: 'item', mastered: true, baseVersion: 0 } };
// @ts-expect-error Unknown actions cannot be dispatched by typed consumers.
transport('deleteEverything', { familyId: 'family' });
// @ts-expect-error A history response has no day field.
transport('getHistory', { familyId: 'family', childId: 'child' }).then((result) => result.day);
// @ts-expect-error The cloud service has the same action/payload contract as its client.
service.execute('identity', 'setMastery', { familyId: 'family', childId: 'child', contentId: 'item', mastered: 'yes', baseVersion: 0 });
// @ts-expect-error Ledger records cannot be stored in the profile collection.
tx.put('profiles', 'user', { records: {} });
function unwrap(response: ApiEnvelope) {
  // @ts-expect-error A failed envelope has no data; callers must narrow ok first.
  return response.data;
}
void [wrongGrade, invalidGrade, wrongKind, wrongRecord, wrongMastery, mixedRequest, unwrap];
