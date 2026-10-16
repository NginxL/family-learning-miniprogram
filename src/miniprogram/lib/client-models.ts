import type { ApiAction, ApiPayloads, ApiResults } from '../../shared/api';
import type { ContentKind, ContentScope, Day, PublicFamily, SchoolGrade, SubjectFilter } from '../../shared/models';
import type { SyncEngine } from './sync-engine';

// Older demo households omit this flag; the cloud response always includes it.
export type ClientFamily = Omit<PublicFamily, 'canJoinFamily'> & { canJoinFamily?: boolean };
type ClientFamilyResponse<T> = T extends { family: infer F }
  ? Omit<T, 'family'> & { family: F extends PublicFamily ? ClientFamily : ClientFamily | null } : T;
export type ClientResults = { [A in ApiAction]: A extends 'setTaskDone'
  ? Omit<ApiResults[A], 'duplicate'> & { duplicate?: boolean } : ClientFamilyResponse<ApiResults[A]> };
export type ClientTransport = <A extends ApiAction>(action: A, payload: ApiPayloads[A]) => Promise<ClientResults[A]>;
export type CommandPayloads = { [A in ApiAction]: Omit<ApiPayloads[A], 'familyId'> };
export type QueuedCheckIn = ApiPayloads['setTaskDone'];
export type CacheActions = { histories: 'getHistory'; progresses: 'getProgress' };
export type CacheBucket = keyof CacheActions;
export type CacheBodies = { [K in CacheBucket]: ClientResults[CacheActions[K]] };
export type Cached<T> = T & { cached: boolean };
export type SyncStatus = 'idle' | 'syncing' | 'online' | 'offline';
export type SyncState = {
  userId: string | null;
  family: ClientFamily | null;
  days: Record<string, Day>;
  queue: QueuedCheckIn[];
  // v1 caches created before history/progress support may omit these fields.
  notice?: string;
} & { [K in CacheBucket]?: Record<string, CacheBodies[K]> };
export type SyncSnapshot = SyncState & { today: string; status: SyncStatus; error: string };
export interface SyncStorage { read(): SyncState | null; write(state: SyncState): void }
export interface SyncOptions { transport: ClientTransport; storage: SyncStorage; makeId?: () => string }
export type AppMode = 'demo' | 'cloud';
export interface Navigation {
  libraryDate?: string;
  childId?: string;
  subject?: SubjectFilter;
  date?: string;
  libraryKind?: ContentKind;
  libraryScope?: ContentScope;
  libraryGrade?: SchoolGrade | 0;
  libraryView?: 'exam';
}
export interface LearningApp {
  engine: SyncEngine;
  mode: AppMode;
  navigation?: Navigation;
  networkListener?: (event: { isConnected: boolean }) => void;
}
