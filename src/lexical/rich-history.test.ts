import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEditor, $getRoot, $createParagraphNode, $createTextNode, $getSelection} from 'lexical';
import {richDocumentsEqual, richImagesEqual, verifiedRichState} from './rich-history.js';
import type {ReviewModel} from '../review-model.js';
const model: ReviewModel = {text: 'a', comments: [], suggestions: [], highlights: []};
const state = (empty = false, text = 'a', selected = false) => {
  const editor = createEditor({onError(error) { throw error; }});
  editor.update(() => { $getRoot().append($createParagraphNode().append($createTextNode(text))); if (empty) $getRoot().append($createParagraphNode()); if (selected) $getRoot().selectEnd(); }, {discrete: true});
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

test('FE-U01 zero-child roots are not verified even when projection matches', () => {
  const richState = createEditor().getEditorState();
  const empty = {...model, text: ''};
  assert.equal(verifiedRichState({model: empty, selection: null, richState}, () => empty), null);
  assert.ok(richState.isEmpty());
});

test('FE-U02,FE-U05 valid empty paragraphs and native selections retain their identity', () => {
  const empty = {...model, text: ''};
  for (const multiple of [false, true]) {
    const richState = state(multiple, '', true);
    const selection = richState.read(() => $getSelection());
    const serialized = richState.toJSON();
    assert.equal(verifiedRichState({model: empty, selection: null, richState}, () => empty), richState);
    assert.deepEqual(richState.toJSON(), serialized);
    assert.equal(richState.read(() => $getSelection()), selection);
  }
});

test('FE-U13 empty repair is separate, verified and preserves null versus caret semantics', async () => {
  const {prepareRichState} = await import('./rich-history.js');
  const {$getSelection, $setSelection} = await import('lexical');
  const empty = {...model, text: ''};
  for (const selection of [null, {anchor: 0, focus: 0}]) {
    const richState = createEditor().getEditorState();
    const target = {model: empty, selection, richState};
    const repaired = prepareRichState(target, () => empty, () => {
      const editor = createEditor();
      editor.update(() => {
        const paragraph = $createParagraphNode(); $getRoot().append(paragraph);
        if (selection) paragraph.selectStart(); else $setSelection(null);
      }, {discrete: true});
      return editor.getEditorState();
    });
    assert.ok(repaired); assert.notEqual(repaired, richState);
    assert.equal(repaired.read(() => $getSelection() === null), selection === null);
    assert.equal(target.richState, richState); assert.ok(richState.isEmpty());
    assert.equal(richState.toJSON().root.children.length, 0);
  }
});

test('FE-U04 invalid nonempty and annotation mismatches never invoke empty preparation', async () => {
  const {prepareRichState} = await import('./rich-history.js');
  const empty = {...model, text: ''}, uninitialized = createEditor().getEditorState();
  let calls = 0;
  const prepare = () => { calls++; return state(false, ''); };
  for (const changed of [model, {...empty, comments: [{id: 'c', start: 0, end: 0, value: 'x'}]},
    {...empty, highlights: [{id: 'h', start: 0, end: 0}]},
    {...empty, suggestions: [{id: 's', type: 'addition' as const, newRange: {start: 0, end: 0}}]}]) {
    assert.equal(prepareRichState({model: changed, selection: null, richState: uninitialized}, () => changed, prepare), null);
  }
  assert.equal(prepareRichState({model: empty, selection: null, richState: uninitialized}, () => model, prepare), null);
  assert.equal(prepareRichState({model: empty, selection: null, richState: state()}, () => model, prepare), null);
  assert.equal(calls, 0);
  assert.equal(prepareRichState({model: empty, selection: null, richState: uninitialized}, () => empty, () => uninitialized), null);
});
