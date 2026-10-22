// Persisted names and IDs are the v1 wire/storage format. Types do not migrate data.
export type ContentKind = 'poetry' | 'word' | 'sentence' | 'english-reading' | 'reading' | 'math' | 'other';
export type Subject = 'poetry' | 'english' | 'reading' | 'math' | 'other';
export type SubjectFilter = Subject | 'all';
export type SchoolGrade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type LearningArea = 'recitation' | 'classical' | 'vocabulary' | 'grammar';
export type ContentScope = 'starter' | 'foundation' | 'moe-all' | 'tables' | 'shanghai54' | 'shanghai-exam' | 'all';
export type LearningMode = 'new' | 'review';
export type TaskMode = LearningMode | 'manual';
export type CalendarDate = string;

export interface GradeMapping {
  grade: SchoolGrade;
  bookId: string;
  schoolSystem: '5-4';
  semester: string;
  edition: string;
  editionStatus?: 'historical_reference' | 'official_resource_verified';
  sourceUrl: string;
  outlineDestination: string;
  sourceKind: string;
  sourcePdfPage?: number;
  sourcePrintPage?: number;
  unit?: string;
  unitId?: string;
  mappingType?: 'textbook_item' | 'aligned_practice';
  evidence: string;
  status: 'catalogue_verified';
}

export interface Content {
  id: string;
  kind: ContentKind;
  title: string;
  detail: string;
  source: string;
  minutes: number;
  subject?: Subject;
  workId?: string;
  note?: string;
  studyGrade?: SchoolGrade | null;
  builtin?: false;
}
export interface StudyNotes {
  title: string;
  notice: string;
  sections: Array<{ title: string; body: string }>;
  exercises: Array<{ question: string; answer: string }>;
  sources: Array<{ title: string; url: string }>;
  searchTerms: string[];
}
export interface KnowledgeItem extends Content {
  minimumServiceVersion?: number;
  recitationPractice?: Array<{ bookId: string; requirement: string; start?: string; end?: string; answerSha256: string }>;
  vocabularyRevision?: string;
  contentRevision?: string;
  commonSenseSources?: Array<{ title: string; url: string }>;
  dictionaryReference?: string;
  textRevision?: { checkedAt: string; summary: string; sourceUrl: string; sourcePrintPages: number[]; sourcePdfPages: number[] };
  studyNotes?: StudyNotes;
  learningArea?: LearningArea;
  manualOnly?: true;
  recitationRequirements?: Array<{ contentId: string; bookId: string; label: string; requirement: string;
    sourcePdfPage: number; sourcePrintPage: number; sourceUrl: string; evidence: string; start?: string; end?: string }>;
  // Explicit containment of complete chapters in a legacy group; never inferred from titles.
  coveredContentIds?: string[];
  studyArea?: 'literacy' | 'pinyin' | 'reading';
  collections: ContentScope[];
  author?: string;
  dynasty?: string;
  dynastyNote?: string;
  aliases?: string[];
  bookIds?: string[];
  curriculumId?: string;
  referenceUrl?: string;
  textSourceUrl?: string;
  gradeMappings?: GradeMapping[];
}
export interface BuiltinReference {
  id: string;
  kind: ContentKind;
  builtin: true;
  studyGrade?: never;
}
export type StoredContent = Content | BuiltinReference;
// Old plans may contain subject without kind; built-in ledger entries contain only an ID.
export interface ContentInput extends Partial<Omit<Content, 'id' | 'builtin'>> {
  id: string;
  contentId?: string;
  builtin?: boolean;
  collections?: ContentScope[];
}
export interface LearningContent extends Content { subject: Subject }
export interface LearningRecord {
  item: StoredContent;
  firstSeen: CalendarDate;
  lastSeen: CalendarDate;
  completedDates: CalendarDate[];
  mastered: boolean;
  version: number;
}
export interface LearningLedger {
  familyId?: string;
  childId?: string;
  records: Record<string, LearningRecord>;
}
export interface PersistedLedger extends LearningLedger { familyId: string; childId: string }
export interface Task extends LearningContent {
  contentId: string;
  childId: string;
  mode: TaskMode;
  done: boolean;
  version: number;
  updatedBy: string | null;
  updatedAt: number | null;
  pending?: boolean;
  repeatAllowed?: true;
}
export type RecitationPolicy = 'all' | 'first' | 'only';
export interface AutoRule {
  kind: ContentKind;
  mode: LearningMode;
  scope: ContentScope;
  quantity: number;
  recitationPolicy?: RecitationPolicy;
}
export interface DailyTemplate { id: string; name: string; rules: AutoRule[] }
export interface WeeklyTemplateSchedule { weekdaysTemplateId: string; weekendTemplateId: string }
export interface TemplateSet { templates: DailyTemplate[]; activeId: string; revision: number; weeklySchedule?: WeeklyTemplateSchedule }
export interface Day {
  familyId?: string;
  date: CalendarDate;
  tasks: Task[];
  generated?: Record<string, Partial<Record<ContentKind, AutoRule & { actual: number }>>>;
  warnings?: Array<{ childId: string; kind: ContentKind; message: string }>;
  planRevision?: number;
  // Date-local exceptions survive regenerated previews; automatic removals also reduce that day's quota.
  omitted?: Array<{ childId: string; key: string; kind: ContentKind; automatic: boolean }>;
}
export interface PlanningChange { date: CalendarDate; targetDate?: CalendarDate; merged: boolean }
export interface ChildProfile {
  id: string;
  name: string;
  birthDate?: CalendarDate | null;
  age?: number | null;
  schoolGrade?: SchoolGrade | null;
  ageRecordedOn?: CalendarDate | null;
  version?: number;
}
export interface Plan extends ContentInput {
  childId: string;
  title: string;
  subject: Subject;
  minutes: number;
  enabled: boolean;
  schedule?: 'once' | 'daily' | 'library';
  date?: CalendarDate;
  startDate?: CalendarDate;
}
export interface PlanningFamily {
  children: Array<{ id: string }>;
  plans: Plan[];
  autoPlans?: Record<string, AutoRule[]>;
  templateSets?: Record<string, TemplateSet>;
  scheduledContents?: Array<{ childId: string; contentId: string; date: CalendarDate }>;
}
export interface Member { id: string; name: string; role: 'owner' | 'guardian' | 'child'; childId?: string }
export interface Family extends PlanningFamily {
  id: string;
  name: string;
  ownerId: string;
  children: ChildProfile[];
  members: Member[];
  createdAt: number;
  activeInviteHash: string | null;
  autoCreated?: boolean;
  homeworkBytes?: number;
}
export interface PublicFamily extends Omit<Family, 'createdAt' | 'activeInviteHash' | 'autoCreated' | 'scheduledContents'> {
  recitationPlanningVersion?: 1;
  templateTodayVersion?: 1;
  myRole: Member['role'];
  canJoinFamily: boolean;
  myChildId?: string;
}
export interface HomeworkScope { familyId: string; childId: string; date: CalendarDate; kind: ContentKind }
export interface HomeworkAttachment extends HomeworkScope {
  id: string; authorId: string; mime: 'image/jpeg' | 'image/png' | 'audio/mpeg'; bytes: number;
  duration: number; digest: string; createdAt: number; fileId?: string;
}
export interface Homework extends HomeworkScope {
  id: string; version: number; submissionId: string; authorId: string; submittedAt: number;
  status: 'pending' | 'approved' | 'returned'; feedback: string; reviewedBy?: string; reviewedAt?: number;
  attachments: string[]; taskVersions: Record<string, number>;
}
export type HomeworkView = Omit<Homework, 'attachments' | 'taskVersions'> & {
  attachments: Array<Pick<HomeworkAttachment, 'id' | 'mime' | 'bytes' | 'duration'>>;
};
export interface HistoryQuery {
  subject?: SubjectFilter;
  filter?: 'all' | 'learned' | 'mastered';
  query?: string;
  offset?: number;
}
export interface CatalogQuery {
  recitation?: 'required' | 'familiar';
  learningArea?: LearningArea;
  kind?: ContentKind;
  subject?: SubjectFilter;
  scope?: ContentScope;
  bookId?: string;
  grade?: SchoolGrade;
  semester?: '上册' | '下册';
  unitId?: string;
  query?: string;
}
export interface KindDefinition { id: ContentKind; subject: Subject; label: string; unit: string; max: number }

export interface DatabaseDocuments {
  profiles: { familyId: string | null };
  families: Family;
  invites: { familyId: string; expiresAt: number; usedAt: number | null; role?: 'guardian' | 'child'; childId?: string; guardianConsentAt?: number };
  days: Day;
  receipts: { familyId: string; fingerprint: string; createdAt: number } & ({ task: Task } | { planning: PlanningChange } | { template: { childId: string } });
  learning: PersistedLedger;
  homeworks: Homework;
  attachments: HomeworkAttachment;
  speechUsage: { characters: number };
}
export type Collection = keyof DatabaseDocuments;
export interface Transaction {
  get<C extends Collection>(collection: C, id: string): Promise<DatabaseDocuments[C] | null>;
  put<C extends Collection>(collection: C, id: string, value: DatabaseDocuments[C]): Promise<void>;
}
export interface Store { run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> }
