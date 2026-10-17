import type { ApiAction } from '../../shared/api';
import type { ChildProfile, ContentInput, Day, Plan, SubjectFilter, Task, TaskMode } from '../../shared/models';
import type { AppMode, ClientFamily, ClientResults, CommandPayloads } from './client-models';
import type { SyncEngine } from './sync-engine';

// This app only updates top-level keys. Avoid the SDK's permissive arbitrary-path setData overload.
export type PageInstance<D, M, R = object> = { data: D; setData(patch: Partial<D>): void } & M & R;
export type PageDefinition<D, M, R = object> = { data: D } & M & ThisType<PageInstance<D, M, R>>;
export type DatasetEvent<D extends object = { id: string }> = {
  currentTarget: Pick<WechatMiniprogram.Target<D>, 'dataset'>;
};
export type ValueEvent<V = string> = Pick<WechatMiniprogram.CustomEvent<{ value: V }>, 'detail'>;
export type FieldEvent<V, D extends object> = ValueEvent<V> & DatasetEvent<D>;
export type PickerEvent = ValueEvent<string | number>;
export type Decorated<T> = T & { kindLabel: string; subjectLabel: string; modeLabel: string; poetryByline?: string; dynastyNote?: string; displayDetail?: string; recitationNote?: string };
export type Decoratable = ContentInput & { mode?: TaskMode };
export type DisplayChild = ChildProfile & { gradeLabel: string };
export interface CommonData {
  family: ClientFamily | null;
  children: DisplayChild[];
  childId: string;
  tasks: Decorated<Task>[];
  plans: Array<Decorated<Plan> & { scheduleLabel: string }>;
  members: Array<ClientFamily['members'][number] & { isMe: boolean; roleLabel: string }>;
  date: string;
  today: string;
  followToday: boolean;
  followTomorrow?: boolean;
  subjectFilter: SubjectFilter;
  subjectOptions: Array<{ id: SubjectFilter; label: string; count?: number }>;
  mode: AppMode;
  busy: boolean;
  isChild: boolean;
  allTaskCount?: number;
  dayWarnings?: Day['warnings'];
  childIndex?: number;
  doneCount?: number;
  minutes?: number;
  percent?: number;
  syncLabel?: string;
  syncError?: string;
  notice?: string;
}
export interface CommonRuntime {
  // Set by onShow before rendering or handling user events.
  engine: SyncEngine;
  active?: boolean;
  unsubscribe?: () => boolean;
  timer?: ReturnType<typeof setInterval>;
  afterRender?(context: { allTasks: Decorated<Task>[] }): void;
  afterSync?(): Promise<void>;
  selectionChanged?(): void | Promise<void>;
}
export interface CommonMethods {
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  cleanup(): void;
  onPullDownRefresh(): Promise<void>;
  render(): void;
  rememberSelection(): void;
  selectChild(event: DatasetEvent): void;
  selectSubject(event: DatasetEvent<{ id: SubjectFilter }>): void;
  refresh(): Promise<void>;
  dismissNotice(): void;
  openFamily(): void;
  openPlans(): void;
  openHistory(): void;
  openLibrary(): void;
  openExamScope(): void;
  openProgress(event?: DatasetEvent): void;
  openToday(): void;
  perform<A extends ApiAction>(action: A, payload: CommandPayloads[A]): Promise<ClientResults[A] | null>;
}
