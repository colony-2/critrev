import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserNixPackage} from './browser-environment.mjs';

const root = '/nix/store/yzi4l8447dkg8iwlvw1p4i9196zhd9d4-chromium-154.0.8037.97';
test('worker launchers resolve the referenced package, including through a symlink', () => {
  const directory = mkdtempSync(join(tmpdir(), 'critrev-launcher-test-'));
  try {
    const launcher = join(directory, 'chromium'), link = join(directory, 'browser');
    symlinkSync(launcher, link);
    for (const target of [`'${root}/bin/chromium'`, `"${root}/bin/chromium"`, `${root}/bin/chromium`]) {
      writeFileSync(launcher, `#!/bin/sh\nexec ${target} "$@"\n`);
      assert.equal(browserNixPackage(launcher), root);
      assert.equal(browserNixPackage(link), root);
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test('unrecognized or executable shell text is refused without evaluating it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'critrev-launcher-test-'));
  try {
    const launcher = join(directory, 'chromium');
    for (const script of ['#!/bin/sh\nexec /usr/bin/chromium "$@"\n',
      `#!/bin/sh\nexec "${root}/bin/$(touch unwanted)" "$@"\n`,
      `#!/bin/sh\nexec '${root}/bin/chromium' "$@"\necho extra\n`]) {
      writeFileSync(launcher, script);
      assert.throws(() => browserNixPackage(launcher), /supply FONTCONFIG_FILE/);
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
