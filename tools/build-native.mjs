// Builds the single-purpose MoveFileEx helper straight into dist/native/bin.
// No generated copy is kept in the src tree. Uses the in-box .NET Framework csc
// (no SDK, no extra native framework). On non-Windows this is a no-op (the
// portable link+rm dev lane is used instead).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'native', 'win32', 'FcMoveFile.cs');
const outDir = path.join(root, 'dist', 'native', 'bin');
const outExe = path.join(outDir, 'fc-movefile.exe');

if (process.platform !== 'win32') {
  console.log('[build-native] non-Windows: skipping fc-movefile.exe (portable dev lane used)');
  process.exit(0);
}

function findCsc() {
  const rootDir = process.env.WINDIR || 'C:\\Windows';
  const framework = path.join(rootDir, 'Microsoft.NET', 'Framework64');
  if (!existsSync(framework)) return null;
  const versions = fs.readdirSync(framework).filter((d) => /^v4/.test(d)).sort();
  for (let i = versions.length - 1; i >= 0; i--) {
    const cand = path.join(framework, versions[i], 'csc.exe');
    if (existsSync(cand)) return cand;
  }
  return null;
}

const csc = findCsc();
if (!csc) {
  console.error('[build-native] csc.exe (.NET Framework v4) not found');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(outExe, { force: true });
execFileSync(csc, ['/nologo', '/target:exe', `/out:${outExe}`, src], { stdio: 'inherit' });
if (!existsSync(outExe)) { console.error('[build-native] helper missing after build'); process.exit(1); }
console.log('[build-native] wrote', outExe);
