import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEditor, $getRoot, $createParagraphNode, $createTextNode} from 'lexical';
import {richDocumentsEqual, richImagesEqual, verifiedRichState} from './rich-history.js';
import type {ReviewModel} from '../review-model.js';
const model: ReviewModel = {text: 'a', comments: [], suggestions: [], highlights: []};
const state = (empty = false, text = 'a') => {
  const editor = createEditor({onError(error) { throw error; }});
  editor.update(() => { $getRoot().append($createParagraphNode().append($createTextNode(text))); if (empty) $getRoot().append($createParagraphNode()); }, {discrete: true});
  return editor.getEditorState();
};
test('U06 saved state verification compares text and every annotation', () => {
  const richState = state(), target = {model, selection: null, richState};
  assert.equal(verifiedRichState(target, () => structuredClone(model)), richState);
  for (const changed of [ {...model, text: 'b'}, {...model, comments: [{id: 'c', start: 0, end: 1, value: 'note'}]},
    {...model, highlights: [{id: 'h', start: 0, end: 1}]}, {...model, suggestions: [{id: 's', type: 'addition' as const, newRange: {start: 0, end: 1}}]} ]) {
    assert.equal(verifiedRichState(target, () => changed), null);
  }
});
test('U07 document comparison sees empty blocks but ignores keys and native selection', () => {
  const a = state(), b = state();
  assert.ok(richDocumentsEqual(a, b));
  assert.ok(richDocumentsEqual(a, a.clone(null)));
  assert.equal(richDocumentsEqual(a, state(true)), false);
});

test('ordinary text growth preserves the image batch, including an empty paragraph', () => {
  assert.ok(richImagesEqual(state(), state(false, 'abc')));
  assert.ok(richImagesEqual(state(false, ''), state()));
});
