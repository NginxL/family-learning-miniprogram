'use strict';
const COLLECTIONS = ['profiles', 'families', 'invites', 'days', 'receipts', 'learning'];

function createCloudStore(db) {
  return {
    run(fn) {
      return db.runTransaction(async (transaction) => fn({
        async get(collection, id) {
          try {
            const result = await transaction.collection(collection).doc(id).get();
            return Array.isArray(result.data) ? (result.data[0] || null) : (result.data || null);
          } catch (error) {
            // Never turn network/permission failures into missing documents.
            if (error.errCode === -502005 || error.code === 'DATABASE_DOCUMENT_NOT_EXIST') return null;
            throw error;
          }
        },
        async put(collection, id, value) {
          const data = { ...value };
          delete data._id;
          await transaction.collection(collection).doc(id).set({ data });
        }
      }));
    }
  };
}
module.exports = { createCloudStore, COLLECTIONS };
