import assert from 'node:assert/strict';
import {test} from 'node:test';
import {copyReviewModel, reviewModelsEqual} from './review-model-equality.js';
import type {ReviewModel} from './review-model.js';
const value: ReviewModel = {text: 'abc', suggestions: [{id: 's', type: 'addition', newRange: {start: 0, end: 2}}], comments: [{id: 'c', start: 0, end: 1, value: 'note'}], highlights: [{id: 'h', start: 1, end: 2}]};
test('U08 complete value equality is independent of property insertion order', () => {
  const reordered = {suggestions: [{newRange: {end: 2, start: 0}, type: 'addition' as const, id: 's'}], text: 'abc', highlights: value.highlights, comments: value.comments};
  assert.ok(reviewModelsEqual(value, reordered)); assert.ok(reviewModelsEqual(value, copyReviewModel(value)));
});
test('U09 every annotation field and presence is significant', () => {
  const variants: ReviewModel[] = [
    {...value, text: 'abcd'}, {...value, suggestions: [{...value.suggestions[0]!, id: 'other'}]},
    {...value, suggestions: [{...value.suggestions[0]!, type: 'deletion'}]},
    {...value, suggestions: [{...value.suggestions[0]!, oldRange: {start: 0, end: 0}}]},
    {...value, suggestions: [{...value.suggestions[0]!, newRange: {start: 1, end: 2}}]},
    {...value, comments: [{...value.comments[0]!, value: 'other'}]},
    {...value, comments: [{...value.comments[0]!, id: 'other'}]},
    {...value, highlights: [{...value.highlights[0]!, end: 3}]},
  ];
  for (const variant of variants) assert.ok(!reviewModelsEqual(value, variant));
  const ordered = {...value, comments: [...value.comments, {...value.comments[0]!, id: 'two'}]};
  assert.ok(!reviewModelsEqual(ordered, {...ordered, comments: [...ordered.comments].reverse()}));
});
test('owned model copies retain nested ranges when the caller mutates its object', () => {
  const input = structuredClone(value); const owned = copyReviewModel(input);
  (input.suggestions[0]!.newRange as {start: number}).start = 2;
  assert.equal(owned.suggestions[0]!.newRange?.start, 0);
});
