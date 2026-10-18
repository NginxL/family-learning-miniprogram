import type { PageDefinition, StudyNotesData, StudyNotesMethods } from './page-types';

// Local disclosure state only. Opening a guide or its answers never records completion.
export function studyNotesView(): PageDefinition<StudyNotesData, StudyNotesMethods> {
  return {
    data: { notesOpenId: '', notesAnswersId: '' },
    toggleStudyNotes(event) {
      const id = event.currentTarget.dataset.id;
      this.setData({ notesOpenId: this.data.notesOpenId === id ? '' : id, notesAnswersId: '' });
    },
    toggleStudyAnswers(event) {
      const id = event.currentTarget.dataset.id;
      if (this.data.notesOpenId !== id) return;
      this.setData({ notesAnswersId: this.data.notesAnswersId === id ? '' : id });
    },
    copyStudySource(event) {
      const url = event.currentTarget.dataset.url;
      if (typeof url === 'string' && url.startsWith('https://')) wx.setClipboardData({ data: url });
    }
  };
}
