import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'critrev-consumer-'));
const run = (command, args, cwd = directory) => execFileSync(command, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
try {
  const packResult = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], process.cwd()));
  const [pack] = Array.isArray(packResult) ? packResult : Object.values(packResult);
  const files = pack.files.map(file => file.path);
  assert.ok(files.includes('README.md'));
  for (const file of files) {
    assert.ok(!/(?:\.test\.|^(?:demo|tests|src)\/|\.map$)/.test(file), `Unexpected published file: ${file}`);
  }
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const entry of Object.values(manifest.exports)) {
    for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) {
      assert.ok(files.includes(target.replace(/^\.\//, '')), `Missing export: ${target}`);
    }
  }
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'critrev-consumer-check', private: true, type: 'module',
    dependencies: {critrev: `file:${join(directory, pack.filename)}`},
  }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  const coreCheck = `
    import assert from 'node:assert/strict';
    import {beforeAfterToReviewModel, finalizeReviewModel} from 'critrev';
    assert.equal(finalizeReviewModel(beforeAfterToReviewModel('a', 'ab')), 'ab');
    assert.throws(() => import.meta.resolve('react'), {code: 'ERR_MODULE_NOT_FOUND'});
  `;
  run(process.execPath, ['--input-type=module', '-e', coreCheck]);
  console.log('Packed core imports without React or a DOM.');

  writeFileSync(join(directory, 'consumer.tsx'), `
    import {createRef} from 'react';
    import {beforeAfterToReviewModel} from 'critrev';
    import {ReviewEditor, ReviewChanges, useReview, type ReviewEditorHandle} from 'critrev/react';
    import {createReviewLexicalAdapter} from 'critrev/lexical';
    const model = beforeAfterToReviewModel('before', 'after');
    function App() {
      const review = useReview({defaultValue: model});
      const ref = createRef<ReviewEditorHandle>();
      return <><ReviewEditor ref={ref} value={review.value} onChange={review.setValue}
        classNames={{addition: 'my-addition'}} contentMode="source" viewMode="revisions" />
        <ReviewChanges value={review.value} renderChange={change =>
          <button onClick={() => review.resolveChange(change.id, 'accept')}>{change.newValue}</button>} /></>;
    }
    void App; void createReviewLexicalAdapter;
  `);
  writeFileSync(join(directory, 'ssr.mjs'), `
    import assert from 'node:assert/strict';
    import {createElement} from 'react';
    import {renderToString} from 'react-dom/server';
    import {beforeAfterToReviewModel} from 'critrev';
    import {ReviewEditor} from 'critrev/react';
    import {createReviewLexicalAdapter} from 'critrev/lexical';
    assert.equal(typeof createReviewLexicalAdapter, 'function');
    assert.match(renderToString(createElement(ReviewEditor, {value: beforeAfterToReviewModel('a', 'b')})), /data-critrev-editor/);
  `);
  for (const version of [18, 19]) {
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `react@${version}`, `react-dom@${version}`, `@types/react@${version}`, `@types/react-dom@${version}`]);
    run(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--jsx', 'react-jsx', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'consumer.tsx']);
    run(process.execPath, ['ssr.mjs']);
    console.log(`Packed React ${version} consumer: TypeScript and server rendering passed.`);
  }
  console.log(`Checked ${pack.filename}: ${files.length} files, ${pack.size} bytes compressed.`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(directory, {recursive: true, force: true});
}
