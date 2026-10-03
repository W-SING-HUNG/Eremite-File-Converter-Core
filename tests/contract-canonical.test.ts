/**
 * Canonical contract regression tests.
 *
 * `tool-contract.json` is an authority-signed external interface. These tests
 * prove the runtime implementation speaks exactly the canonical shape, and that
 * the shipped schema is well-formed.
 *
 * A full JSON Schema 2020-12 implementation would be a new production
 * dependency, which RC3 forbids. Instead this file contains a minimal
 * in-repo validator covering precisely the keywords the canonical schema uses:
 *   $ref (internal), type (incl. union), const, enum, pattern, minLength,
 *   maxLength, minimum, maximum, required, additionalProperties, properties,
 *   items, minItems, uniqueItems, oneOf, format(uuid).
 *
 * NOTE on `format`: in Draft 2020-12 `format` is an annotation, not an
 * assertion. The canonical schema uses `"format": "uuid"` to express that
 * invocationId must be a UUID; this validator therefore treats `format: uuid`
 * as an assertion so the UUIDv7 acceptance test below is meaningful.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ERROR_CODES, STAGES } from '../src/core/errors.js';
import { PUBLIC_WARNING_CODES } from '../src/core/warnings.js';
import { TECHNICAL_CONVERSIONS } from '../src/core/technical-support.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(path.join(ROOT, 'tool-contract.json'), 'utf8')) as Schema;

/* ── minimal 2020-12 subset validator ─────────────────────────────────────── */

type Schema = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRef(ref: string, root: Schema): Schema {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  let cur: any = root;
  for (const part of ref.slice(2).split('/')) {
    cur = cur?.[part];
    if (cur === undefined) throw new Error(`unresolvable $ref: ${ref}`);
  }
  return cur as Schema;
}

/** JSON type name; integers are distinguished from numbers. */
function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(schemaType: string, v: unknown): boolean {
  const t = typeOf(v);
  if (schemaType === 'number') return t === 'integer' || t === 'number';
  return t === schemaType;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function walk(s: Schema, v: unknown, at: string, root: Schema, out: string[]): void {
  if (s.$ref !== undefined) { walk(resolveRef(s.$ref as string, root), v, at, root, out); return; }

  if (s.type !== undefined) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(t, v))) {
      out.push(`${at}: expected type ${JSON.stringify(s.type)}, got ${typeOf(v)}`);
      return; // further keywords are meaningless once the type is wrong
    }
  }

  if (s.const !== undefined && !same(s.const, v)) out.push(`${at}: expected const ${JSON.stringify(s.const)}`);

  if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => same(e, v))) {
    out.push(`${at}: value is not in enum (${JSON.stringify(v)})`);
  }

  if (s.oneOf !== undefined) {
    const n = (s.oneOf as Schema[]).filter((sub) => validate(sub, v, root).valid).length;
    if (n !== 1) out.push(`${at}: oneOf matched ${n} subschemas, expected exactly 1`);
  }

  if (typeof v === 'string') {
    if (s.pattern !== undefined && !new RegExp(s.pattern as string).test(v)) {
      out.push(`${at}: does not match pattern ${s.pattern}`);
    }
    if (s.minLength !== undefined && v.length < (s.minLength as number)) out.push(`${at}: shorter than minLength ${s.minLength}`);
    if (s.maxLength !== undefined && v.length > (s.maxLength as number)) out.push(`${at}: longer than maxLength ${s.maxLength}`);
    if (s.format === 'uuid' && !UUID_RE.test(v)) out.push(`${at}: not a valid uuid`);
  }

  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < (s.minimum as number)) out.push(`${at}: below minimum ${s.minimum}`);
    if (s.maximum !== undefined && v > (s.maximum as number)) out.push(`${at}: above maximum ${s.maximum}`);
  }

  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    for (const r of (s.required ?? []) as string[]) {
      if (!(r in obj)) out.push(`${at}: missing required property "${r}"`);
    }
    const props = (s.properties ?? {}) as Record<string, Schema>;
    if (s.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(k in props)) out.push(`${at}: additional property "${k}" is not allowed`);
      }
    }
    for (const k of Object.keys(obj)) {
      if (props[k]) walk(props[k], obj[k], `${at}.${k}`, root, out);
    }
  }

  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < (s.minItems as number)) out.push(`${at}: fewer than minItems ${s.minItems}`);
    if (s.items !== undefined) v.forEach((item, i) => walk(s.items as Schema, item, `${at}[${i}]`, root, out));
    if (s.uniqueItems === true) {
      const seen = new Set<string>();
      v.forEach((item, i) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) out.push(`${at}: duplicate item at index ${i} (uniqueItems)`);
        else seen.add(key);
      });
    }
  }
}

function validate(s: Schema, value: unknown, root: Schema = schema): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  walk(s, value, '$', root, errors);
  return { valid: errors.length === 0, errors };
}

/** Validate against a named $defs entry (e.g. 'error'). */
const validateDef = (name: string, value: unknown) => validate(schema.$defs[name], value);

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Generate a real UUIDv7 (48-bit ms timestamp + version 7 + variant 10xx). */
function uuidV7(): string {
  const b = randomBytes(16);
  const ms = Date.now();
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = Math.floor(ms / 2 ** 24) & 0xff;
  b[3] = Math.floor(ms / 2 ** 16) & 0xff;
  b[4] = Math.floor(ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | (b[6]! & 0x0f); // version nibble = 7
  b[8] = 0x80 | (b[8]! & 0x3f); // variant = 10x
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V4 = '123e4567-e89b-42d3-a456-426614174000';
const SHA = 'a'.repeat(64);

/** A canonical-shaped request; conversionId is injectable to isolate the conflict. */
function makeRequest(conversionId: string, invocationId: string = UUID_V4) {
  return {
    kind: 'request',
    contractVersion: 1,
    invocationId,
    workspace: { rootPath: 'C:/ws', inputPath: 'C:/ws/in/a.png', outputPath: 'C:/ws/out/o.jpg' },
    source: { displayName: 'a.png', declaredMediaType: 'image/png', byteSize: 1024, sha256: SHA },
    conversion: {
      conversionId,
      target: { formatId: 'jpeg', mediaType: 'image/jpeg', extension: '.jpg' },
      enginePlan: { primaryEngineId: 'sharp', fallbackEngineId: null },
    },
    limits: { maxInputBytes: 1048576, maxOutputBytes: 1048576, maxWorkspaceBytes: 1048576, timeoutMs: 30000 },
  };
}

/* ── tests ────────────────────────────────────────────────────────────────── */

describe('canonical contract: schema integrity', () => {
  it('is a JSON Schema 2020-12 document with the canonical $id', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe('https://eremite.local/contracts/file-converter/v1.1/canonical-tool-contract-v1.1.json');
  });

  it('admits exactly request | successResponse | failureResponse', () => {
    expect((schema.oneOf as Schema[]).map((s) => s.$ref)).toEqual([
      '#/$defs/request', '#/$defs/successResponse', '#/$defs/failureResponse',
    ]);
  });

  it('declares every $def used by the document', () => {
    expect(Object.keys(schema.$defs).sort()).toEqual([
      'engine', 'error', 'failureResponse', 'format', 'request', 'sha256',
      'successResponse', 'warning',
    ]);
  });

  it('the validator resolves every $ref the schema uses', () => {
    // Guards against a typo'd $ref silently disabling a whole branch.
    const refs = new Set<string>();
    const collect = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(collect); return; }
      if (n && typeof n === 'object') {
        const o = n as Record<string, unknown>;
        if (typeof o.$ref === 'string') refs.add(o.$ref);
        Object.values(o).forEach(collect);
      }
    };
    collect(schema);
    expect(refs.size).toBeGreaterThan(0);
    for (const r of refs) expect(() => resolveRef(r, schema)).not.toThrow();
  });
});

describe('canonical contract: error + warning + stage enums', () => {
  it('every one of the 32 canonical error codes validates as an error DTO', () => {
    expect(ERROR_CODES).toHaveLength(32);
    for (const code of ERROR_CODES) {
      const r = validateDef('error', { code, stage: 'engine', retryable: false });
      expect(r.valid, `${code}: ${r.errors.join('; ')}`).toBe(true);
    }
  });

  it('an unknown FC_* code is rejected', () => {
    const r = validateDef('error', { code: 'FC_NOT_A_REAL_CODE', stage: 'engine', retryable: false });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('enum'))).toBe(true);
  });

  it('every one of the 8 canonical warning codes validates', () => {
    expect(PUBLIC_WARNING_CODES).toHaveLength(8);
    for (const code of PUBLIC_WARNING_CODES) {
      const r = validateDef('warning', { code });
      expect(r.valid, `${code}: ${r.errors.join('; ')}`).toBe(true);
    }
  });

  it('a warning carries code ONLY — extra fields are rejected', () => {
    expect(validateDef('warning', { code: 'FC_METADATA_DROPPED', message: 'stripped' }).valid).toBe(false);
  });

  it('all 8 canonical stages are accepted, including workspace', () => {
    expect(STAGES).toEqual(['request', 'input', 'detection', 'engine', 'output', 'resource', 'internal', 'workspace']);
    for (const stage of STAGES) {
      const r = validateDef('error', { code: 'FC_INTERNAL_ERROR', stage, retryable: false });
      expect(r.valid, `${stage}: ${r.errors.join('; ')}`).toBe(true);
    }
  });
});

describe('canonical contract: response shape', () => {
  it('error DTO is exactly { code, stage, retryable } — message/recovery/details rejected', () => {
    expect(validateDef('error', { code: 'FC_IO_FAILED', stage: 'output', retryable: true }).valid).toBe(true);
    for (const extra of ['message', 'recovery', 'details', 'stack', 'path', 'stderr', 'command']) {
      const r = validateDef('error', { code: 'FC_IO_FAILED', stage: 'output', retryable: true, [extra]: 'x' });
      expect(r.valid, `${extra} must be rejected`).toBe(false);
    }
  });

  it('engine carries id+version ONLY, and additionalProperties is closed', () => {
    expect(validateDef('engine', { id: 'sharp', version: 'sharp-0.34' }).valid).toBe(true);
    expect(validateDef('engine', { id: 'sharp', version: 'sharp-0.34', fallback: false }).valid).toBe(false);
    expect(validateDef('engine', { id: 'sharp' }).valid).toBe(false); // version is required
  });

  it('fallback is a TOP-LEVEL required property of the success response', () => {
    expect(schema.$defs.successResponse.required).toContain('fallback');
    expect(schema.$defs.successResponse.properties.fallback).toBeDefined();
    // and it is NOT part of the engine object
    expect(Object.keys(schema.$defs.engine.properties)).toEqual(['id', 'version']);
  });

  it('fallback { used: false } is the only legal v1.1 shape; used:true needs a reasonCode', () => {
    expect(validate(schema.$defs.successResponse.properties.fallback, { used: false }).valid).toBe(true);
    expect(validate(schema.$defs.successResponse.properties.fallback, { used: true }).valid).toBe(false);
    const withReason = { used: true, primaryEngineId: 'libreoffice', reasonCode: 'PRIMARY_FAILED' };
    expect(validate(schema.$defs.successResponse.properties.fallback, withReason).valid).toBe(true);
  });

  it('a failure response rejects extra properties', () => {
    const base = {
      kind: 'response', contractVersion: 1, invocationId: UUID_V4, status: 'failed',
      coreVersion: '1.1.0', durationMs: 5, warnings: [],
      errors: [{ code: 'FC_IO_FAILED', stage: 'output', retryable: true }],
    };
    expect(validateDef('failureResponse', base).valid).toBe(true);
    expect(validateDef('failureResponse', { ...base, message: 'boom' }).valid).toBe(false);
    // at least one error is required
    expect(validateDef('failureResponse', { ...base, errors: [] }).valid).toBe(false);
  });
});

describe('canonical contract: invocationId (UUIDv7)', () => {
  it('accepts a classic v4 UUID', () => {
    const r = validateDef('request', makeRequest('png-jpeg', UUID_V4));
    expect(r.valid, r.errors.join('; ')).toBe(true);
  });

  it('accepts a real UUIDv7', () => {
    const v7 = uuidV7();
    expect(v7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const r = validateDef('request', makeRequest('png-jpeg', v7));
    expect(r.valid, r.errors.join('; ')).toBe(true);
  });

  it('rejects a non-UUID invocationId', () => {
    const r = validateDef('request', makeRequest('png-jpeg', 'not-a-uuid'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('uuid'))).toBe(true);
  });
});

/**
 * RESOLVED — RC3 follow-up, per authority ruling.
 *
 * The canonical `conversion.conversionId` pattern
 *   ^[a-z0-9][a-z0-9.-]{0,95}$
 * does not admit ">", so the historical "from->to" spelling could never satisfy
 * the canonical contract. Per the ruling the contract stays UNTOUCHED; instead
 * the 18 conversionIds were migrated to the canonical-compatible
 * `<source>-to-<target>` spelling, and conversionId is now treated as an OPAQUE
 * stable identifier whose (source,target) mapping lives in the Core registry.
 *
 * These tests pin the resolution and guard against the legacy spelling
 * creeping back in.
 */
describe('canonical contract: conversionId spelling (RESOLVED)', () => {
  it('every production conversionId satisfies the canonical pattern', () => {
    const ids = TECHNICAL_CONVERSIONS.map((c) => c.id);
    expect(ids).toHaveLength(18);
    for (const id of ids) {
      const r = validateDef('request', makeRequest(id));
      expect(r.valid, `${id}: ${r.errors.join('; ')}`).toBe(true);
    }
  });

  it('conversionIds are opaque: canonical-compatible and never parsed from "->"', () => {
    for (const c of TECHNICAL_CONVERSIONS) {
      expect(c.id).not.toContain('->');
      expect(c.id).toMatch(/^[a-z0-9][a-z0-9.-]{0,95}$/);
      // the (source,target) mapping is explicit in the registry, not encoded in
      // the id string — this pins the spelling without implying it is parseable.
      expect(c.id).toBe(`${c.from}-to-${c.to}`);
    }
  });

  it('the legacy "from->to" spelling is rejected (cannot creep back)', () => {
    const r = validateDef('request', makeRequest('png->jpeg'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('conversionId') && e.includes('pattern'))).toBe(true);
  });
});
