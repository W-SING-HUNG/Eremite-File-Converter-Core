/**
 * Vitest global setup: the MoveFileEx helper is a BUILD artifact (dist/native/bin),
 * never a checked-in source-tree binary. Build it once before the suite so the
 * no-clobber tests can resolve it when running straight from TS sources.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helper = path.join(root, 'dist', 'native', 'bin', process.platform === 'win32' ? 'fc-movefile.exe' : 'fc-movefile');

export default function setup(): void {
  if (process.platform === 'win32' && !existsSync(helper)) {
    execFileSync(process.execPath, [path.join(root, 'tools', 'build-native.mjs')], { stdio: 'inherit', cwd: root });
  }
}
