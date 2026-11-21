import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageSuites, verifyBrowserResults} from './browser-results.mjs';

const report = () => ({errors: [], suites: imageSuites.map((file, line) => ({specs: [{file, line, column: 1, title: file,
  tests: [{projectName: 'chromium', status: 'expected', results: [{status: 'passed', retry: 0}]}]}]}))});
test('complete browser results pass', () => assert.deepEqual(verifyBrowserResults(report(), report(), ['chromium']), {chromium: 7}));
test('identical case titles in different fixture groups remain distinct', () => {
  const value = report();
  value.suites.push({title: 'imperative', suites: structuredClone(value.suites)});
  assert.deepEqual(verifyBrowserResults(value, value, ['chromium']), {chromium: 14});
});
for (const [name, change] of [
  ['missing suite', value => value.suites.pop()],
  ['truncated case', value => value.suites[0].specs[0].tests.pop()],
  ['skipped case', value => { value.suites[0].specs[0].tests[0].results[0].status = 'skipped'; }],
  ['failed case', value => { value.suites[0].specs[0].tests[0].status = 'unexpected'; }],
  ['flaky retry', value => { value.suites[0].specs[0].tests[0].results.push({status: 'passed', retry: 1}); }],
  ['runner error', value => value.errors.push({message: 'worker exited'})],
  ['duplicate case', value => value.suites.push(structuredClone(value.suites[0]))],
]) test(`reject ${name}`, () => {
  const value = report(); change(value);
  assert.throws(() => verifyBrowserResults(value, report(), ['chromium']));
});
test('an incomplete inventory cannot waive a required suite', () => {
  const value = report(); value.suites.pop();
  assert.throws(() => verifyBrowserResults(value, value, ['chromium']));
});
