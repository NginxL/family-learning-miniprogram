// Generated display catalogue; textbook references never create learning records.
interface CurriculumSlot {
  id: string; subject: 'chinese' | 'english'; subjectLabel: string; grade: number;
  semester: string; stage: 'primary' | 'junior'; fullCoverage: boolean;
  contentBookId: string; verifiedCount: number; contentNote: string; mappingNote: string;
  references: Array<{ title: string; publisher: string; url: string; period: string; verification: string }>;
}
declare const resources: {
  checkedAt: string;
  books: Array<{ id: string; title: string; [field: string]: unknown }>;
  examFramework: { complete: boolean; [field: string]: unknown };
  coverage: unknown;
  curriculum: { target: string; complete: boolean; slots: CurriculumSlot[] };
  links: unknown;
};
export = resources;
