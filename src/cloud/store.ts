import type { Collection, DatabaseDocuments, Store, Transaction } from '../shared/models';

export const COLLECTIONS: Collection[] = ['profiles', 'families', 'invites', 'days', 'receipts', 'learning'];
// SDK transaction results are JSON at the boundary; schema ownership remains in service.ts.
export interface CloudDatabase {
  runTransaction<T>(work: (tx: {
    collection(name: string): { doc(id: string): {
      get(): Promise<{ data?: unknown }>;
      set(input: { data: object }): Promise<unknown>;
    } };
  }) => Promise<T>): Promise<T>;
}
export function createCloudStore(db: CloudDatabase): Store {
  return {
    run<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
      return db.runTransaction(async (transaction) => fn({
        async get<C extends Collection>(collection: C, id: string): Promise<DatabaseDocuments[C] | null> {
          try {
            const result = await transaction.collection(collection).doc(id).get();
            // Only this adapter decodes persisted v1 records; no client-supplied objects enter here.
            return (Array.isArray(result.data) ? (result.data[0] || null) : (result.data || null)) as DatabaseDocuments[C] | null;
          } catch (error) {
            const detail = error as { errCode?: unknown; code?: unknown } | null;
            if (detail && (detail.errCode === -502005 || detail.code === 'DATABASE_DOCUMENT_NOT_EXIST')) return null;
            throw error;
          }
        },
        async put<C extends Collection>(collection: C, id: string, value: DatabaseDocuments[C]): Promise<void> {
          const data: DatabaseDocuments[C] & { _id?: unknown } = { ...value };
          delete data._id;
          await transaction.collection(collection).doc(id).set({ data });
        }
      }));
    }
  };
}
