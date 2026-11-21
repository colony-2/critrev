import assert from 'node:assert/strict';

export const imageSuites = ['image-editor.spec.ts', 'image-paste.spec.ts', 'image-previews.spec.ts',
  'image-history.spec.ts', 'markdown-images.spec.ts', 'markdown-inspection.spec.ts', 'fresh-empty-history.spec.ts'];

const cases = report => {
  const found = [];
  const visit = (suite, parents = []) => {
    const path = [...parents, suite.title];
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      found.push({key: JSON.stringify([path, spec.file, spec.line, spec.column, spec.title, test.projectName]), file: spec.file, test});
    }
    for (const child of suite.suites ?? []) visit(child, path);
  };
  for (const suite of report.suites) visit(suite);
  return found;
};

export function verifyBrowserResults(report, inventory, projects) {
  assert.deepEqual(report.errors ?? [], [], 'Browser runner reported errors');
  assert.deepEqual(inventory.errors ?? [], [], 'Browser inventory reported errors');
  const expected = cases(inventory), actual = cases(report);
  assert.ok(expected.length > 0, 'Browser inventory is empty');
  assert.equal(new Set(actual.map(item => item.key)).size, actual.length, 'Duplicate browser results');
  assert.deepEqual(actual.map(item => item.key).sort(), expected.map(item => item.key).sort(), 'Missing or unexpected browser results');
  for (const project of projects) {
    const selected = actual.filter(item => item.test.projectName === project);
    for (const suite of imageSuites) assert.ok(selected.some(item => item.file.split('/').at(-1) === suite), `Missing ${project} suite ${suite}`);
    assert.ok(selected.every(({test}) => test.status === 'expected' && test.results.length === 1 &&
      test.results[0].status === 'passed' && test.results[0].retry === 0), 'Every required browser check must pass once without skips or retries');
  }
  return Object.fromEntries(projects.map(project => [project, actual.filter(item => item.test.projectName === project).length]));
}
