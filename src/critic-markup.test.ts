import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beforeAfterToCriticMarkup,
  finalizeCriticMarkup,
  parseCriticMarkup,
  serializeCriticMarkup,
} from './critic-markup.js';

test('parses all CriticMarkup primitives', () => {
  assert.deepEqual(
    parseCriticMarkup(
      'a {++new++} {--old--} {~~before~>after~~} {>>note<<} {==range==}',
    ),
    [
      {type: 'text', value: 'a '},
      {type: 'addition', value: 'new'},
      {type: 'text', value: ' '},
      {type: 'deletion', value: 'old'},
      {type: 'text', value: ' '},
      {type: 'substitution', oldValue: 'before', newValue: 'after'},
      {type: 'text', value: ' '},
      {type: 'comment', value: 'note'},
      {type: 'text', value: ' '},
      {type: 'highlight', value: 'range'},
    ],
  );
});

test('serializes parsed CriticMarkup without changing valid input', () => {
  const source =
    'this {~~is **a great idea** for us.~>**great** for us~~}{>>reviewed<<}';

  assert.equal(serializeCriticMarkup(parseCriticMarkup(source)), source);
});

test('finalizes change markers and preserves comments by default', () => {
  assert.equal(
    finalizeCriticMarkup(
      'a {++new++} {--old--} {~~before~>after~~} {>>note<<} {==range==}{>>why<<}',
    ),
    'a new  after {>>note<<} {==range==}{>>why<<}',
  );
});

test('finalizer can strip comments and range comments', () => {
  assert.equal(
    finalizeCriticMarkup(
      'a {++new++} {>>note<<} {==range==}{>>why<<}',
      {preserveComments: false},
    ),
    'a new  range',
  );
});

test('bare highlights are unwrapped during finalization', () => {
  assert.equal(finalizeCriticMarkup('keep {==this==} text'), 'keep this text');
});

test('substitutions can cross markdown formatting boundaries as one unit', () => {
  const source = 'this {~~is **a great idea** for us.~>**great** for us~~}';
  const nodes = parseCriticMarkup(source);

  assert.deepEqual(nodes, [
    {type: 'text', value: 'this '},
    {
      type: 'substitution',
      oldValue: 'is **a great idea** for us.',
      newValue: '**great** for us',
    },
  ]);
  assert.equal(finalizeCriticMarkup(nodes), 'this **great** for us');
});

test('escaped CriticMarkup delimiters remain literal text', () => {
  const source = String.raw`literal \{++not an add++}`;
  const nodes = parseCriticMarkup(source);

  assert.deepEqual(nodes, [{type: 'text', value: 'literal {++not an add++}'}]);
  assert.deepEqual(parseCriticMarkup(serializeCriticMarkup(nodes)), nodes);
});

test('before/after conversion preserves unchanged markdown', () => {
  assert.equal(
    beforeAfterToCriticMarkup('# Title\n\nBody', '# Title\n\nBody'),
    '# Title\n\nBody',
  );
});

test('before/after conversion emits line additions and deletions', () => {
  assert.equal(
    beforeAfterToCriticMarkup('a\nc', 'a\nb\nc'),
    'a\n{++b++}\nc',
  );
  assert.equal(
    beforeAfterToCriticMarkup('a\nb\nc', 'a\nc'),
    'a\n{--b--}\nc',
  );
});

test('before/after conversion emits inline additions and deletions', () => {
  assert.equal(
    beforeAfterToCriticMarkup('hello world', 'hello brave world'),
    'hello {++brave ++}world',
  );
  assert.equal(
    beforeAfterToCriticMarkup('hello brave world', 'hello world'),
    'hello {--brave --}world',
  );
});

test('before/after conversion keeps a formatting-boundary edit atomic', () => {
  const before = 'this is **a great idea** for us.';
  const after = 'this **great** for us';
  const criticMarkup = beforeAfterToCriticMarkup(before, after);

  assert.equal(
    criticMarkup,
    'this {~~is **a great idea** for us.~>**great** for us~~}',
  );
  assert.equal(finalizeCriticMarkup(criticMarkup), after);
});
