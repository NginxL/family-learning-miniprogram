import type { ApiTransport } from '../../src/shared/api';
import type { LearningApp, QueuedCheckIn, SyncState } from '../../src/miniprogram/lib/client-models';
import type { CommonRuntime, PageInstance } from '../../src/miniprogram/lib/page-types';
import type { FamilyData, FamilyMethods } from '../../src/miniprogram/pages/family/index';
import type { PlansData, PlansMethods, RuleDraft } from '../../src/miniprogram/pages/plans/index';
import type { TodayData, TodayMethods } from '../../src/miniprogram/pages/today/index';
import { SyncEngine } from '../../src/miniprogram/lib/sync-engine';

declare const transport: ApiTransport;
declare const state: SyncState;
declare const today: PageInstance<TodayData, TodayMethods, CommonRuntime>;
declare const family: PageInstance<FamilyData, FamilyMethods, CommonRuntime>;
declare const plans: PageInstance<PlansData, PlansMethods, CommonRuntime>;
declare const rule: RuleDraft;
declare const app: LearningApp;

const engine = new SyncEngine({ transport, storage: { read: () => state, write: () => {} } });
engine.enqueueMany('2026-10-13', ['task'], true);
engine.command('createInvite', {}).then((result) => result.code.toUpperCase());
engine.getHistory({ childId: 'child', filter: 'mastered' }).then((result) => result.total.toFixed());
family.perform('updateChild', { childId: 'child', name: '测试', baseVersion: 0, schoolGrade: 3 });
plans.setData({ rules: [{ ...rule, quantity: '' }] }); // An empty input is valid draft state.
today.setData({ busy: true, groupPercent: 25 });

// @ts-expect-error Offline writes use booleans, not the switch's string representation.
engine.enqueue('2026-10-13', 'task', 'true');
// @ts-expect-error A group needs an array of task IDs.
engine.enqueueMany('2026-10-13', 'task', true);
// @ts-expect-error A queued operation must retain its mutation ID for retry deduplication.
const incomplete: QueuedCheckIn = { familyId: 'family', date: '2026-10-13', taskId: 'task', done: true, baseVersion: 0 };
// @ts-expect-error Queue version numbers remain numeric across persisted v1 caches.
state.queue[0].baseVersion = '1';
// @ts-expect-error Page commands must convert form strings before sending them.
engine.command('addPlan', { childId: 'child', title: '测试', subject: 'math', minutes: '5' });
// @ts-expect-error Profile changes require optimistic-concurrency version checks.
family.perform('updateChild', { childId: 'child', name: '测试', schoolGrade: 1 });
// @ts-expect-error Page state only accepts supported grades.
family.setData({ editGrade: 10 });
// @ts-expect-error setData must not introduce misspelled top-level data keys.
today.setData({ groupPercnet: 25 });
// @ts-expect-error Page loading flags are booleans.
today.setData({ busy: 'yes' });
// @ts-expect-error Quantity is a number or an empty draft, not arbitrary text.
plans.setData({ rules: [{ ...rule, quantity: '30' }] });
// @ts-expect-error Typed page results are linked to their action.
family.perform('createInvite', {}).then((result) => result?.task);
// @ts-expect-error History and progress caches cannot be interchanged.
engine.getHistory({ childId: 'child' }).then((result) => result.grades);
// @ts-expect-error Navigation preserves the same content-kind vocabulary as the API.
app.navigation = { libraryKind: 'words' };
void incomplete;
