import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync('dist/build-info.json', JSON.stringify({
  version,
  revision: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
}, null, 2) + '\n');
