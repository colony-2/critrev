import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ModelHistory, type ModelSnapshot} from './model-history.js';
const snap = (text: string, anchor = text.length, focus = anchor, atom = false): ModelSnapshot => ({model: {text, suggestions: [], comments: [], highlights: []}, selection: {anchor, focus, ...(atom ? {atom} : {})}});
test('U10 insertion restores backward text and atom selection through replay', () => {
  const history = new ModelHistory(); const before = snap('target', 6, 0); const after = snap('![a](b)', 7);
  history.record(before, after); let restored: ModelSnapshot | undefined;
  assert.ok(history.replay('undo', x => { restored = x; return true; })); assert.deepEqual(restored, before);
  assert.ok(history.replay('redo', x => { restored = x; return true; })); assert.deepEqual(restored, after);
  const selected = snap('![a](b)', 0, 7, true); history.record(selected, snap(''));
  history.replay('undo', x => { assert.deepEqual(x, selected); return true; });
});
test('U11,U13 refused replay preserves target, redo branch and original spelling', () => {
  const history = new ModelHistory(); history.record(snap('_source_'), snap('after'));
  assert.equal(history.replay('undo', () => false), false);
  assert.ok(history.replay('undo', x => { assert.equal(x.model.text, '_source_'); return true; }));
  assert.equal(history.replay('redo', () => false), false);
  assert.ok(history.replay('redo', x => { assert.equal(x.model.text, 'after'); return true; }));
});
test('U12 typing grouping, image boundaries, branch edits and clear', () => {
  const history = new ModelHistory();
  history.record(snap(''), snap('a'), true, 100); history.record(snap('a'), snap('ab'), true, 200);
  history.record(snap('ab'), snap('ab![a](b)'), false, 210);
  history.record(snap('ab![a](b)'), snap('ab![a](b)c'), true, 220);
  const undo = (text: string) => assert.ok(history.replay('undo', x => { assert.equal(x.model.text, text); return true; }));
  undo('ab![a](b)'); undo('ab'); undo('');
  assert.equal(history.replay('undo', () => true), false);
  history.record(snap(''), snap('new')); assert.equal(history.replay('redo', () => true), false);
  history.clear(); assert.equal(history.replay('undo', () => true), false);
});
test('U01,U02 immutable rich endpoints travel with copied models and selections', async () => {
  const {createEditor, $getRoot, $createParagraphNode} = await import('lexical');
  const editor = createEditor({onError(error) { throw error; }});
  editor.update(() => $getRoot().append($createParagraphNode()), {discrete: true});
  const first = editor.getEditorState(), second = first.clone(null), last = first.clone();
  const before = {...snap(''), richState: first}, after = {...snap('a'), richState: second};
  const history = new ModelHistory(); history.record(before, after, true, 100);
  (before.model as {text: string}).text = 'mutated'; before.selection!.anchor = 99;
  history.record({...snap('a'), richState: second}, {...snap('ab'), richState: last}, true, 200);
  (after.model as {text: string}).text = 'mutated';
  history.replay('undo', x => { assert.equal(x.model.text, ''); assert.equal(x.selection!.anchor, 0); assert.equal(x.richState, first); (x.model as {text: string}).text = 'again'; return true; });
  history.replay('redo', x => { assert.equal(x.model.text, 'ab'); assert.equal(x.richState, last); return true; });
  history.replay('undo', x => { assert.equal(x.model.text, ''); return true; });
});
test('U04 boundaries, distance and elapsed time prevent typing grouping', () => {
  for (const separate of ['boundary', 'selection', 'time']) {
    const history = new ModelHistory(); history.record(snap(''), snap('a'), true, 100);
    if (separate === 'boundary') history.boundary();
    history.record(snap('a', separate === 'selection' ? 0 : 1), snap('ab'), true, separate === 'time' ? 400 : 200);
    history.replay('undo', x => { assert.equal(x.model.text, 'a'); return true; });
    history.replay('undo', x => { assert.equal(x.model.text, ''); return true; });
  }
});

test('FE-U03,FE-U06,FE-U07 copied empty endpoints distinguish no selection from caret zero', async () => {
  const {createEditor, $getRoot, $createParagraphNode} = await import('lexical');
  const editor = createEditor(); editor.update(() => $getRoot().append($createParagraphNode()), {discrete: true});
  const richState = editor.getEditorState();
  const before = {...snap(''), selection: null, richState}, after = {...snap(''), richState};
  const history = new ModelHistory(); history.record(before, after);
  assert.equal(history.replay('undo', target => { (target.model as {text: string}).text = 'not saved'; return false; }), false);
  assert.ok(history.replay('undo', target => { assert.equal(target.model.text, ''); assert.equal(target.selection, null); assert.equal(target.richState, richState); return true; }));
  assert.equal(history.replay('redo', () => false), false);
  assert.ok(history.replay('redo', target => { assert.deepEqual(target.selection, {anchor: 0, focus: 0}); assert.equal(target.richState, richState); target.selection!.anchor = 42; return true; }));
  history.replay('undo', () => true);
  history.replay('redo', target => { assert.equal(target.selection!.anchor, 0); return true; });
});
