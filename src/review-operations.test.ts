import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addReviewComment, beforeAfterToReviewModel, criticMarkupToReviewModel,
  finalizeReviewModel, insertReviewText, reconcileReviewEdit, removeReviewComment,
  reviewModelForView, reviewModelToCriticMarkup, updateReviewComment,
} from './index.js';

test('diff reviews support independent accept/reject previews without mutating the original', () => {
  const before = '# Title\n\nShip the draft.';
  const after = '# Title\n\nShip the polished draft.';
  const model = beforeAfterToReviewModel(before, after);
  assert.equal(reviewModelForView(model, 'accept').text, after);
  assert.equal(reviewModelForView(model, 'reject').text, before);
  assert.equal(reviewModelForView(model, 'revisions'), model);
  assert.ok(model.suggestions.length > 0);
});

test('point/range comments can be created, updated, removed and serialized independently', () => {
  const initial = criticMarkupToReviewModel('Hello team');
  const ranged = addReviewComment(initial, {id: 'range', start: 6, end: 10, value: 'Who?'});
  const pointed = addReviewComment(ranged, {start: 0, end: 0, value: 'Intro'});
  const updated = updateReviewComment(pointed, 'range', 'Which team?');
  assert.equal(reviewModelToCriticMarkup(updated), '{>>Intro<<}Hello {==team==}{>>Which team?<<}');
  assert.equal(initial.comments.length, 0);
  assert.equal(ranged.comments[0]?.value, 'Who?');
  assert.equal(removeReviewComment(updated, 'range').comments.length, 1);
  assert.equal(finalizeReviewModel(updated, {preserveComments: false}), 'Hello team');
  assert.deepEqual(criticMarkupToReviewModel(reviewModelToCriticMarkup(updated)).comments.map(c => c.value), ['Intro', 'Which team?']);
});

test('invalid comment ranges and duplicate ids are rejected', () => {
  const model = addReviewComment(criticMarkupToReviewModel('Hello'), {id: 'note', start: 0, end: 0, value: 'Note'});
  for (const range of [{start: -1, end: 0}, {start: 3, end: 2}, {start: 0, end: 6}, {start: 0.5, end: 1}, {start: NaN, end: 1}]) {
    assert.throws(() => addReviewComment(model, {...range, value: 'Note'}), RangeError);
  }
  assert.throws(() => addReviewComment(model, {id: 'note', start: 0, end: 0, value: 'Duplicate'}));
  assert.throws(() => updateReviewComment(model, 'missing', 'Note'), RangeError);
});

test('edits on clean text create suggestions and preserve comment offsets', () => {
  const baseline = addReviewComment(criticMarkupToReviewModel('Hello team'), {start: 6, end: 10, value: 'Who?'});
  const edited = insertReviewText(baseline, 6, 'whole ');
  const next = reconcileReviewEdit(baseline, edited);
  assert.equal(reviewModelToCriticMarkup(next), 'Hello {++whole ++}{==team==}{>>Who?<<}');
  assert.equal(reviewModelForView(next, 'reject').text, 'Hello team');
  assert.equal(reviewModelForView(next, 'accept').text, 'Hello whole team');
});

test('deletions and replacements are suggestions, while editing a suggestion keeps its id', () => {
  const baseline = criticMarkupToReviewModel('Hello team');
  const deletion = reconcileReviewEdit(baseline, {...baseline, text: 'Hello '});
  assert.equal(reviewModelToCriticMarkup(deletion), 'Hello {--team--}');
  const replacement = reconcileReviewEdit(baseline, {...baseline, text: 'Hello people'});
  assert.equal(reviewModelForView(replacement, 'accept').text, 'Hello people');
  assert.equal(reviewModelForView(replacement, 'reject').text, 'Hello team');
  const addition = criticMarkupToReviewModel('Hello {++team++}');
  const edited = insertReviewText(addition, 8, 's');
  assert.equal(reconcileReviewEdit(addition, edited), edited);
});
