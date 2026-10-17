const test = require('node:test');
const assert = require('node:assert/strict');
const coverage = require('../data/catalogs/shanghai-54-coverage.json');
const resources = require('../shared/resources.json');
const regional = require('../data/catalogs/shanghai-54-evidence.json');
const lowerPrimary = require('../data/catalogs/shanghai-54-lower-primary.json');
const gradeThree = require('../data/catalogs/shanghai-54-grade3.json');
const gradeFour = require('../data/catalogs/shanghai-54-grade4.json');
const gradeFive = require('../data/catalogs/shanghai-54-grade5.json');
const gradeSix = require('../data/catalogs/shanghai-54-grade6.json');
const gradeSeven = require('../data/catalogs/shanghai-54-grade7.json');
const gradeEight = require('../data/catalogs/shanghai-54-grade8.json');
const learning = require('../shared/learning');

test('Shanghai curriculum inventories all 36 subject-semesters without turning book listings into knowledge coverage', () => {
  assert.deepEqual(coverage.primaryGrades, [1, 2, 3, 4, 5]);
  assert.deepEqual(coverage.juniorGrades, [6, 7, 8, 9]);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.slots.length, 36);
  for (let grade = 1; grade <= 9; grade += 1) {
    const slots = resources.curriculum.slots.filter(slot => slot.grade === grade);
    assert.deepEqual(new Set(slots.map(slot => `${slot.subject}:${slot.semester}`)), new Set(['chinese:上册', 'chinese:下册', 'english:上册', 'english:下册']));
    for (const slot of slots) {
      assert.equal(slot.stage, grade <= 5 ? 'primary' : 'junior');
      assert.equal(slot.fullCoverage, false); assert.equal(slot.schoolAdoption, 'pending');
      assert.ok(slot.references.every(ref => coverage.sources.some(source => source.id === ref.sourceId)));
      if (slot.subject === 'english') {
        if (grade > 8) { assert.equal(slot.verifiedCount, 0); assert.equal(slot.contentBookId, ''); }
        if (slot.semester === '下册') assert.ok(slot.references.every(ref => ref.verification === 'historical_resource_listing' && ref.period === '2025学年第二学期'));
      }
      if (slot.contentBookId) {
        const book = [...regional.books, ...lowerPrimary.books, ...gradeThree.books, ...gradeFour.books, ...gradeFive.books, ...gradeSix.books, ...gradeSeven.books, ...gradeEight.books].find(book => book.id === slot.contentBookId);
        assert.equal(book.grade, grade); assert.equal(book.semester, slot.semester);
        const actual = learning.searchCatalog({ grade }).filter(item => item.gradeMappings.some(mapping => mapping.bookId === book.id)).length;
        assert.equal(slot.verifiedCount, actual);
      }
    }
  }
  assert.equal(resources.curriculum.slots.filter(slot => slot.availableUnits).length, 32);
  assert.equal(resources.curriculum.slots.reduce((sum, slot) => sum + slot.availableUnits, 0), 273);
  assert.ok(learning.progress({ records: {} }).grades.every(grade => !grade.fullGradeComplete));
});

test('textbook browser selects four semester records for each grade and keeps learning filters independent', t => {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  for (let index = 0; index < 9; index += 1) {
    page.changeCurriculumGrade({ detail: { value: String(index) } });
    assert.equal(page.data.curriculumSlots.length, 4);
    assert.ok(page.data.curriculumSlots.every(slot => slot.grade === index + 1));
    assert.equal(page.data.grade, 0); assert.equal(page.data.view, 'content');
  }
  page.changeCurriculumGrade({ detail: { value: '9' } });
  assert.equal(page.data.curriculumGradeIndex, 8);
});
