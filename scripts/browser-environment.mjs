import assert from 'node:assert/strict';
import {readFileSync, realpathSync} from 'node:fs';

// Worker package bindings are shell launchers, rather than symlinks. Only
// unwrap the simple exec form emitted by the worker; never evaluate shell text.
export function browserNixPackage(executable) {
  const resolved = realpathSync(executable);
  const storeRoot = path => path.match(/^\/nix\/store\/[a-z0-9]{32}-[^/]+(?=\/)/)?.[0];
  const direct = storeRoot(resolved);
  if (direct) return direct;
  const launcher = readFileSync(resolved, 'utf8');
  const match = launcher.match(/^#!\/bin\/sh\r?\nexec (?:'([^'\r\n]+)'|"([^"$`\r\n]+)"|(\/nix\/store\/[^\s'"$`]+)) "\$@"\r?\n?$/);
  const wrapped = match && storeRoot(match[1] ?? match[2] ?? match[3]);
  assert.ok(wrapped, 'Cannot locate the browser Nix package; supply FONTCONFIG_FILE for working fonts');
  return wrapped;
}
