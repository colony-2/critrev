import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const workspace = process.cwd();
const directory = mkdtempSync(join(tmpdir(), 'critrev-consumer-'));
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const run = (command, values, cwd = directory, env = process.env) => execFileSync(command, values, {cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024});
const identity = filename => {
  const bytes = readFileSync(filename);
  return {sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64')};
};
let tarball;
try {
  let packed;
  const supplied = argument('--tarball');
  const project = argument('--project');
  assert.ok(!project || ['chromium', 'mobile-chrome'].includes(project), 'Unknown browser project');
  if (supplied) tarball = resolve(supplied);
  else {
    const result = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], workspace));
    [packed] = Array.isArray(result) ? result : Object.values(result);
    tarball = join(directory, packed.filename);
  }
  const originalIdentity = identity(tarball);
  if (argument('--sha256')) assert.equal(originalIdentity.sha256, argument('--sha256'), 'Tarball SHA-256 mismatch');
  if (argument('--integrity')) assert.equal(originalIdentity.integrity, argument('--integrity'), 'Tarball npm integrity mismatch');
  if (packed) assert.equal(packed.integrity, originalIdentity.integrity);
  // Inspect supplied bytes directly. Explicit-tarball checking never calls npm pack.
  const files = run('tar', ['-tzf', tarball]).trim().split('\n').map(x => x.replace(/^package\//, ''));
  for (const file of ['README.md', 'LICENSE', 'package.json']) assert.ok(files.includes(file), `Missing ${file}`);
  for (const file of files) assert.ok(!/(?:\.test\.|^(?:demo|tests|src|review)\/|\.map$)/.test(file), `Unexpected published file: ${file}`);
  const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
  assert.equal(manifest.license, 'MIT');
  assert.match(run('tar', ['-xOf', tarball, 'package/LICENSE']), /MIT License/);
  for (const entry of Object.values(manifest.exports)) {
    for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) assert.ok(files.includes(target.replace(/^\.\//, '')), `Missing export: ${target}`);
  }
  writeFileSync(join(directory, 'package.json'), JSON.stringify({name: 'critrev-consumer-check', private: true, type: 'module', dependencies: {critrev: `file:${tarball}`}}));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {beforeAfterToReviewModel, finalizeReviewModel} from 'critrev';
    assert.equal(finalizeReviewModel(beforeAfterToReviewModel('a', 'ab')), 'ab');
    assert.throws(() => import.meta.resolve('react'), {code: 'ERR_MODULE_NOT_FOUND'});
    assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  `]);
  writeFileSync(join(directory, 'core.ts'), `import {beforeAfterToReviewModel, finalizeReviewModel} from 'critrev'; const text: string = finalizeReviewModel(beforeAfterToReviewModel('a', 'ab')); void text;`);
  writeFileSync(join(directory, 'core-tsconfig.json'), JSON.stringify({compilerOptions: {strict: true, exactOptionalPropertyTypes: true, target: 'ES2022', lib: ['ES2022'], types: [], module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true}, files: ['core.ts']}));
  const tsc = resolve(workspace, 'node_modules/typescript/bin/tsc');
  run(process.execPath, [tsc, '-p', 'core-tsconfig.json']);
  console.log('Packed core runtime and strict ES2022-only types pass without React or DOM.');
  writeFileSync(join(directory, 'consumer.tsx'), `
    import {createRef} from 'react';
    import {beforeAfterToReviewModel} from 'critrev';
    import {ReviewEditor, ReviewChanges, useReview, type ReviewEditorHandle,
      type ReviewImage, type ReviewImagePasteResult, type ReviewImagePasteOutcome,
      type ReviewImagePasteFailure, type ReviewMarkdownInspection} from 'critrev/react';
    import {createReviewLexicalAdapter, type ReviewImage as AdapterImage,
      type ReviewImagePasteResult as AdapterResult, type ReviewImagePasteOutcome as AdapterOutcome,
      type ReviewImagePasteFailure as AdapterFailure, type ReviewMarkdownInspection as AdapterInspection} from 'critrev/lexical';
    const image: ReviewImage = {src: 'pasted.png', alt: 'Diagram', title: ''};
    const adapterImage: AdapterImage = image;
    const paste = (files: readonly File[]): ReviewImagePasteResult => ({images: files.map(() => image)});
    const outcome = (result: ReviewImagePasteOutcome) => { if (!result.inserted) { const reason: ReviewImagePasteFailure = result.reason; void reason; } };
    const compatiblePaste: (files: readonly File[]) => AdapterResult = paste;
    const compatibleOutcome: (value: AdapterOutcome) => void = outcome;
    const failure: AdapterFailure = 'insertion-failed'; void failure;
    function App() {
      const review = useReview({defaultValue: beforeAfterToReviewModel('before', 'after')});
      const ref = createRef<ReviewEditorHandle>();
      ref.current?.insertImages([image]); const inspected: ReviewMarkdownInspection | undefined = ref.current?.inspectMarkdown('plain'); void inspected;
      return <><ReviewEditor ref={ref} value={review.value} onChange={review.setValue} trackChanges={false}
        onPasteImages={paste} onPasteImagesResult={outcome} onError={error => console.error(error.message)}
        imagePreviews={new Map([['pasted.png', 'blob:host-owned']])} contentMode="source" />
        <ReviewChanges value={review.value} renderChange={change => <span>{change.newValue}</span>} /></>;
    }
    function imperative(root: HTMLElement) {
      const adapter = createReviewLexicalAdapter(root, {onChange() {}, onPasteImages: compatiblePaste, onPasteImagesResult: compatibleOutcome});
      const inserted: boolean = adapter.insertImages([adapterImage]);
      const result: AdapterInspection = adapter.inspectMarkdown('plain');
      adapter.setImagePreviews(new Map()); adapter.dispose(); return {inserted, result};
    }
    void App; void imperative;
  `);
  writeFileSync(join(directory, 'ssr.mjs'), `
    import assert from 'node:assert/strict';
    import {createElement} from 'react'; import {renderToString} from 'react-dom/server';
    import {beforeAfterToReviewModel} from 'critrev'; import {ReviewEditor} from 'critrev/react';
    import {createReviewLexicalAdapter} from 'critrev/lexical';
    assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
    assert.equal(typeof createReviewLexicalAdapter, 'function');
    assert.match(renderToString(createElement(ReviewEditor, {value: beforeAfterToReviewModel('a', 'b'),
      imagePreviews: new Map(), onPasteImages() { throw Error('must not run during SSR'); },
      onPasteImagesResult() { throw Error('must not run during SSR'); }})), /data-critrev-editor/);
  `);
  for (const version of [18, 19]) {
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `react@${version}`, `react-dom@${version}`, `@types/react@${version}`, `@types/react-dom@${version}`]);
    run(process.execPath, [tsc, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--jsx', 'react-jsx', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'consumer.tsx']);
    run(process.execPath, ['ssr.mjs']); console.log(`Packed React ${version}: strict public APIs and SSR passed.`);
  }
  if (args.includes('--browser')) {
    // Copy only the fixture into the installed consumer. Every runtime import is
    // resolved there; no workspace source module is available through its imports.
    mkdirSync(join(directory, 'demo/src'), {recursive: true});
    for (const name of ['images.html', 'src/image-fixture.tsx', 'src/image-fixture.css']) cpSync(join(workspace, 'demo', name), join(directory, 'demo', name));
    const packageRoot = join(directory, 'node_modules/critrev');
    assert.ok(existsSync(join(packageRoot, 'dist/react/index.js')));
    const env = {...process.env, CRITREV_PACKAGE_ROOT: packageRoot, CRITREV_DEMO_ROOT: join(directory, 'demo'), PLAYWRIGHT_BROWSERS_PATH: resolve(workspace, '.cache/ms-playwright')};
    const playwright = resolve(workspace, 'node_modules/@playwright/test/cli.js');
    execFileSync(process.execPath, [playwright, 'test', 'image-editor.spec.ts', 'image-paste.spec.ts', 'image-previews.spec.ts', 'image-history.spec.ts', 'markdown-images.spec.ts', 'markdown-inspection.spec.ts', '--workers=2', '--max-failures=5', ...(project ? ['--project', project] : [])], {cwd: workspace, env, stdio: 'inherit'});
    console.log(`Installed-tarball browser fixtures passed (${project ?? 'desktop and mobile Chromium'}).`);
  } else console.log('Browser checks were not requested; use --browser for delivery acceptance.');
  assert.deepEqual(identity(tarball), originalIdentity, 'Tarball bytes changed during validation');
  console.log(JSON.stringify({version: manifest.version, tarball, ...originalIdentity, files: files.length}, null, 2));
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally { rmSync(directory, {recursive: true, force: true}); }
