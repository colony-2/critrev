import assert from 'node:assert/strict';
import test from 'node:test';

import {
  criticMarkupToReviewModel,
  finalizeReviewModel,
  listReviewChanges,
  reviewModelToCriticMarkup,
  withAddedSuggestion,
} from './review-model.js';

test('imports CriticMarkup into an offset-based review model', () => {
  const model = criticMarkupToReviewModel(
    'a {++new++} {--old--} {~~before~>after~~} {==range==}{>>note<<}{>>point<<}',
  );

  assert.equal(model.text, 'a new old beforeafter range');
  assert.deepEqual(
    listReviewChanges(model).map(change => ({
      newValue: change.newValue,
      oldValue: change.oldValue,
      type: change.type,
    })),
    [
      {newValue: 'new', oldValue: '', type: 'addition'},
      {newValue: '', oldValue: 'old', type: 'deletion'},
      {newValue: 'after', oldValue: 'before', type: 'substitution'},
    ],
  );
  assert.deepEqual(
    model.comments.map(comment => ({
      start: comment.start,
      end: comment.end,
      value: comment.value,
    })),
    [
      {start: 22, end: 27, value: 'note'},
      {start: 27, end: 27, value: 'point'},
    ],
  );
});

test('exports the review model back to CriticMarkup', () => {
  const source =
    'this {~~is **a great idea** for us.~>**great** for us~~}\n\n{==Please ship==}{>>tighten<<} it{>>owner<<}';
  const model = criticMarkupToReviewModel(source);

  assert.equal(reviewModelToCriticMarkup(model), source);
  assert.equal(
    finalizeReviewModel(model),
    'this **great** for us\n\n{==Please ship==}{>>tighten<<} it{>>owner<<}',
  );
});

test('the model can represent a comment on part of an addition', () => {
  const model = withAddedSuggestion(
    {
      comments: [{id: 'c1', start: 4, end: 8, value: 'check this word'}],
      highlights: [],
      suggestions: [],
      text: 'add word',
    },
    {newRange: {start: 0, end: 8}, type: 'addition'},
  );

  assert.equal(
    reviewModelToCriticMarkup(model),
    '{++add {==word==}{>>check this word<<}++}',
  );
});

test('point comments at suggestion boundaries stay outside suggestion payloads', () => {
  const model = withAddedSuggestion(
    {
      comments: [{id: 'c1', start: 4, end: 4, value: 'owner'}],
      highlights: [],
      suggestions: [],
      text: 'base plus',
    },
    {newRange: {start: 4, end: 9}, type: 'addition'},
  );

  assert.equal(reviewModelToCriticMarkup(model), 'base{>>owner<<}{++ plus++}');
});
