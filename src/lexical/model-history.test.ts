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
