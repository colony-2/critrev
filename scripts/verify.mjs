import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {browserNixPackage} from './browser-environment.mjs';

// Run the same entry point locally and from the lifecycle verify hook. Reports
// survive failed commands; delivery bytes always come from a clean Git revision.
const reports = resolve(process.argv[2] ?? join(tmpdir(), 'critrev-verification'));
const focused = process.argv.includes('--focused');
const focus = 'FE-T01|FE-N01|FE-N02|FE-N05.*immediate fresh wysiwyg switched first source edit|FE-I01.*immediate fresh wysiwyg switched|FE-N09|FE-N15|FE-I06|R01,R03|R04,R05 final image Delete title=Draft flow|P01,P02|V01,V02|A12 visual|M01|I04,I05|A05,A06';
assert.ok(!existsSync(reports), `Choose a new report directory: ${reports}`);
mkdirSync(reports, {recursive: true});
const temporary = mkdtempSync(join(tmpdir(), 'critrev-fonts-'));
const env = {...process.env};
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const run = (name, command, args, overrides = {}) => {
  console.log(`Running ${name}`);
  const log = join(reports, `${name}.log`), fd = openSync(log, 'w');
  let result;
  try { result = spawnSync(command, args, {env: {...env, ...overrides}, stdio: ['ignore', fd, fd], detached: true}); }
  finally { closeSync(fd); }
  assert.ok(!result.error && result.status === 0, `${name} failed (${result.error?.message ?? result.signal ?? result.status}); inspect ${log}`);
  console.log(`Passed ${name}`);
};
try {
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Commit the managed candidate before delivery validation');
  const revision = git('rev-parse', 'HEAD');
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??= execFileSync('sh', ['-c', 'command -v chromium'], {encoding: 'utf8'}).trim();
  // Minimal Linux workers may have no system font configuration. Reuse fonts
  // already in the approved browser's closure; never install another package.
  if (!env.FONTCONFIG_FILE && !existsSync('/etc/fonts/fonts.conf')) {
    const browserPackage = browserNixPackage(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
    const closure = execFileSync('nix-store', ['--query', '--requisites', browserPackage], {encoding: 'utf8'}).trim().split('\n');
    const fonts = closure.filter(path => /-dejavu-fonts[^/]*$/.test(path)).map(path => join(path, 'share/fonts/truetype')).filter(existsSync);
    assert.ok(fonts.length, 'Supply FONTCONFIG_FILE for a browser with working fonts');
    env.FONTCONFIG_FILE = join(temporary, 'fonts.conf');
    writeFileSync(env.FONTCONFIG_FILE, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>${fonts.map(path => `<dir>${path}</dir>`).join('')}<cachedir>${temporary}/cache</cachedir></fontconfig>`);
  }
  writeFileSync(join(reports, 'runtime.txt'), `Node ${process.version}\nnpm ${execFileSync('npm', ['--version'], {encoding: 'utf8'}).trim()}\n${execFileSync(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, ['--version'], {encoding: 'utf8'})}Source ${revision}\n`);
  run('install', 'npm', ['ci']);
  run('report-guards', process.execPath, ['--test', 'scripts/browser-results.test.mjs']);
  for (const script of ['typecheck', 'test', 'build', 'build:demo']) run(script.replace(':', '-'), 'npm', ['run', script]);
  run('general-browser', process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'react.spec.ts', 'demo.spec.ts', '--workers=2', '--reporter=list,json'],
    {PLAYWRIGHT_JSON_OUTPUT_NAME: join(reports, 'general-browser.json'), CRITREV_TEST_PORT: env.CRITREV_TEST_PORT ?? '5195'});
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', reports], {encoding: 'utf8'}))[0];
  const tarball = join(reports, packed.filename), bytes = readFileSync(tarball);
  const identity = {version: packed.version, revision, filename: packed.filename,
    sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64')};
  writeFileSync(join(reports, 'package-identity.json'), JSON.stringify(identity, null, 2) + '\n');
  for (const [index, project] of ['chromium', 'mobile-chrome'].entries()) {
    run(`matrix-${project}`, process.execPath, ['scripts/check-package.mjs', '--tarball', tarball,
      '--sha256', identity.sha256, '--integrity', identity.integrity, '--revision', revision,
      '--browser', '--source-browser', '--project', project, ...(focused ? ['--grep', focus] : []),
      '--results', join(reports, project, 'results'), '--captures', join(reports, project, 'captures')],
    {CRITREV_TEST_PORT: String(Number(env.CRITREV_TEST_PORT ?? 5195) + index + 1)});
  }
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Verification changed managed source');
  assert.equal(git('rev-parse', 'HEAD'), revision, 'Managed revision changed during verification');
  console.log(`${focused ? 'Focused' : 'Full'} checks passed for ${identity.version} at ${revision}`);
} finally { rmSync(temporary, {recursive: true, force: true}); }
