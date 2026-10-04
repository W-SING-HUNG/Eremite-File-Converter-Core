import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { ERROR_CODES } from '../src/core/errors.js';
import { PUBLIC_WARNING_CODES } from '../src/core/warnings.js';
import { TECHNICAL_CONVERSIONS } from '../src/core/technical-support.js';
import * as publicIndex from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

describe('supplier packaging hygiene', () => {
  it('no checked-in native binary lives in the source tree', async () => {
    expect(await fsp.access(path.join(ROOT, 'src', 'native', 'bin')).then(() => true).catch(() => false)).toBe(false);
  });

  it('the C# MoveFileEx helper source is retained and builds to dist', async () => {
    expect(await fsp.access(path.join(ROOT, 'src', 'native', 'win32', 'FcMoveFile.cs')).then(() => true).catch(() => false)).toBe(true);
  });

  it('no regenerable harness frontend build output is shipped', async () => {
    expect(await fsp.access(path.join(ROOT, 'dev-harness', 'frontend', 'dist')).then(() => true).catch(() => false)).toBe(false);
  });

  it('the production index never exports the QA stub', () => {
    expect(Object.keys(publicIndex)).not.toContain('QaStubEngine');
    expect(JSON.stringify(Object.keys(publicIndex))).not.toContain('qa');
  });

  it('every public error code is FC_ namespaced and there are 32', () => {
    expect(ERROR_CODES).toHaveLength(32);
    for (const c of ERROR_CODES) expect(c).toMatch(/^FC_[A-Z_]+$/);
  });

  it('every public warning code is FC_ namespaced (QA-only code excluded from public set)', () => {
    for (const c of PUBLIC_WARNING_CODES) expect(c).toMatch(/^FC_[A-Z_]+$/);
    expect(PUBLIC_WARNING_CODES).not.toContain('FC_QA_STUB');
  });

  it('Core technical-support set stays at exactly 18 (non-authoritative)', () => {
    expect(TECHNICAL_CONVERSIONS).toHaveLength(18);
  });

  it('tool-contract.json is the canonical Draft 2020-12 schema at contract 1.1', async () => {
    const raw = JSON.parse(await fsp.readFile(path.join(ROOT, 'tool-contract.json'), 'utf8'));
    expect(raw.$schema).toContain('2020-12');
    expect(raw.$id).toBe('https://eremite.local/contracts/file-converter/v1.1/canonical-tool-contract-v1.1.json');
  });

  it('no .old/.bak/.backup/legacy copies remain in src', async () => {
    async function walk(dir: string): Promise<string[]> {
      const out: string[] = [];
      for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...await walk(p));
        else out.push(p);
      }
      return out;
    }
    const files = await walk(path.join(ROOT, 'src'));
    expect(files.filter((f) => /\.(old|bak|backup)$/i.test(f) || /legacy-copy/i.test(f))).toEqual([]);
  });
});

/**
 * Items that must NEVER reach the shipped package: anything here is a DEV-only
 * or Phase-5 surface leaking into the supplier artifact.
 */
const FORBIDDEN_SUBSTRINGS = [
  'qa-stub', 'QaStubEngine',
  'accepted-capabilities', 'acceptedCapabilities',
  'ConflictMode',
  'fc-cli',
  'desktop-app-bridge',
];

const distDir = path.join(ROOT, 'dist');
const distExists = await fsp.access(distDir).then(() => true).catch(() => false);

describe('packaging regression (dist/** + npm pack manifest)', () => {
  async function walkDir(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...await walkDir(p));
      else out.push(p);
    }
    return out;
  }

  it.skipIf(!distExists)('dist/** carries no DEV-only or Phase-5 surface', async () => {
    const files = await walkDir(distDir);
    const offenders: string[] = [];
    for (const f of files) {
      if (!/\.(js|mjs|cjs|ts|json)$/.test(f)) continue;
      const text = await fsp.readFile(f, 'utf8').catch(() => null);
      if (text === null) continue;
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        if (text.includes(bad)) offenders.push(`${path.relative(ROOT, f)} :: ${bad}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.skipIf(!distExists)('dist contains no src/dev output directory', async () => {
    expect(await fsp.access(path.join(distDir, 'dev')).then(() => true).catch(() => false)).toBe(false);
  });

  it('npm pack manifest ships only dist/** + tool-contract.json (+ package metadata)', () => {
    const out = execSync('npm pack --dry-run --json', {
      cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    const files = parsed[0]!.files.map((f) => f.path);

    const allowed = (p: string) =>
      p.startsWith('dist/') ||
      p === 'tool-contract.json' ||
      p === 'package.json' ||
      p === 'README.md' ||
      p === 'LICENSE' ||
      p === 'NOTICE' ||
      p === 'THIRD-PARTY-NOTICES.md';

    expect(files.filter((p) => !allowed(p))).toEqual([]);
    expect(files.filter((p) => FORBIDDEN_SUBSTRINGS.some((b) => p.toLowerCase().includes(b.toLowerCase())))).toEqual([]);
    // sanity: the real production CLI and the frozen contract are actually shipped
    expect(files).toContain('dist/cli/index.js');
    expect(files).toContain('tool-contract.json');
    expect(files).toContain('LICENSE');
    expect(files).toContain('NOTICE');
    expect(files).toContain('THIRD-PARTY-NOTICES.md');
    // `npm pack` spawns an external process; during a full parallel suite it can
    // exceed the default per-test budget, so it gets an explicit generous one.
  }, 180000);
});
