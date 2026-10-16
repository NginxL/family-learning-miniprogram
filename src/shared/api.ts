import type { AutoRule, CalendarDate, ContentKind, Day, HistoryQuery, PublicFamily, SchoolGrade, Subject, Task, HomeworkScope, HomeworkView, HomeworkAttachment } from './models';
import type { history, progress } from './learning';

export interface ProfileInput {
  birthDate?: CalendarDate | null;
  age?: number | null;
  schoolGrade?: SchoolGrade | null;
}
export interface FamilyScope { familyId: string }
export interface ChildScope extends FamilyScope { childId: string }
export interface ContentRequest extends ChildScope { contentId: string }

// Keep actions, payloads and results linked. A getHistory call cannot return a day.
export interface ApiPayloads {
  bootstrap: { ensureDefault?: boolean };
  createFamily: ProfileInput & { name: string; memberName: string; childName: string };
  joinFamily: { code: string; memberName: string; replaceDefaultFamilyId?: string };
  createInvite: FamilyScope & { role?: 'guardian' | 'child'; childId?: string; guardianConsent?: boolean };
  removeMember: FamilyScope & { memberId: string };
  leaveFamily: FamilyScope;
  addChild: FamilyScope & ProfileInput & { name: string };
  updateChild: ChildScope & ProfileInput & { name: string; baseVersion: number };
  addPlan: ChildScope & {
    title: string; detail?: string; subject: Subject; kind?: ContentKind;
    schedule?: 'once' | 'daily' | 'library'; date?: CalendarDate; minutes: number; studyGrade?: SchoolGrade | null;
  };
  setPlanEnabled: FamilyScope & { planId: string; enabled: boolean };
  saveAutoPlans: ChildScope & { rules: AutoRule[] };
  getDay: FamilyScope & { date?: CalendarDate };
  getHistory: ChildScope & HistoryQuery;
  getProgress: ChildScope;
  setMastery: ContentRequest & { mastered: boolean; baseVersion: number };
  reviewContent: ContentRequest;
  assignContent: ContentRequest & { date?: CalendarDate };
  setTaskDone: FamilyScope & { date: CalendarDate; taskId: string; done: boolean; baseVersion: number; mutationId: string };
  uploadHomeworkAttachment: HomeworkScope & { uploadId: string; mime: HomeworkAttachment['mime']; base64: string; duration: number };
  submitHomework: HomeworkScope & { submissionId: string; attachmentIds: string[]; baseVersion: number };
  getHomework: HomeworkScope;
  getHomeworkAttachment: HomeworkScope & { attachmentId: string };
  reviewHomework: HomeworkScope & { baseVersion: number; decision: 'approve' | 'return'; feedback?: string };
}
export interface ApiResults {
  bootstrap: { userId: string; today: CalendarDate; family: PublicFamily | null };
  createFamily: { family: PublicFamily };
  joinFamily: { family: PublicFamily };
  createInvite: { code: string; expiresAt: number };
  removeMember: { removed: true };
  leaveFamily: { removed: true };
  addChild: { family: PublicFamily };
  updateChild: { family: PublicFamily };
  addPlan: { family: PublicFamily };
  setPlanEnabled: { family: PublicFamily };
  saveAutoPlans: { family: PublicFamily };
  getDay: { day: Day; today: CalendarDate };
  getHistory: ReturnType<typeof history>;
  getProgress: ReturnType<typeof progress>;
  setMastery: { mastered: boolean };
  reviewContent: { task: Task; date: CalendarDate };
  assignContent: { task: Task; date: CalendarDate };
  setTaskDone: { task: Task; duplicate: boolean };
  uploadHomeworkAttachment: { attachmentId: string };
  submitHomework: { homework: HomeworkView };
  getHomework: { homework: HomeworkView | null };
  getHomeworkAttachment: { mime: HomeworkAttachment['mime']; base64: string };
  reviewHomework: { homework: HomeworkView };
}
export type ApiAction = keyof ApiPayloads;
export type ApiData = ApiResults[ApiAction];
export type ApiRequest = { [A in ApiAction]: { action: A; payload: ApiPayloads[A] } }[ApiAction];
export type ApiEnvelope<T = ApiData> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type ApiTransport = <A extends ApiAction>(action: A, payload: ApiPayloads[A]) => Promise<ApiResults[A]>;
export interface FamilyService {
  execute<A extends ApiAction>(openid: string, action: A, payload: ApiPayloads[A]): Promise<ApiResults[A]>;
  // The cloud entry accepts untrusted JSON. Runtime authorization/validation happens here.
  executeRaw(openid: unknown, action: unknown, payload?: unknown): Promise<ApiData>;
}
