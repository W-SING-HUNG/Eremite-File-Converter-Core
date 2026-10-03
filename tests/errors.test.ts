import { describe, it, expect } from 'vitest';
import { ERROR_CODES, RECOVERY, STAGES, ToolError, toToolError } from '../src/core/errors.js';
import { PUBLIC_WARNING_CODES } from '../src/core/warnings.js';

describe('error taxonomy (canonical Host Contract v1.1)', () => {
  it('has exactly 32 stable FC_* codes', () => {
    expect(ERROR_CODES).toHaveLength(32);
    expect(new Set(ERROR_CODES).size).toBe(32);
    for (const c of ERROR_CODES) expect(c.startsWith('FC_')).toBe(true);
  });

  it('every code has one of the three recovery semantics', () => {
    for (const c of ERROR_CODES) {
      expect(['immediate_retry', 'after_user_action', 'never']).toContain(RECOVERY[c]);
    }
  });

  it('pinned recovery mapping (canonical sample)', () => {
    expect(RECOVERY.FC_SOURCE_CHANGED).toBe('immediate_retry');
    expect(RECOVERY.FC_DEPENDENCY_MISSING).toBe('after_user_action');
    expect(RECOVERY.FC_SOURCE_CORRUPT).toBe('never');
    expect(RECOVERY.FC_UNSAFE_INPUT_PATH).toBe('after_user_action');
    expect(RECOVERY.FC_RESOURCE_BUNDLE_REQUIRED).toBe('after_user_action');
    expect(RECOVERY.FC_IO_FAILED).toBe('immediate_retry');
    expect(RECOVERY.FC_OUTPUT_CONFLICT).toBe('after_user_action');
    expect(RECOVERY.FC_UNSUPPORTED_FEATURE).toBe('after_user_action');
  });

  it('public error DTO is exactly { code, stage, retryable } — no message/recovery/details leak', () => {
    const j = new ToolError('FC_TIMEOUT', 'internal raw text', { ms: 1, stderrTail: 'boom' }).toJSON();
    expect(j).toEqual({ code: 'FC_TIMEOUT', stage: 'internal', retryable: true });
    expect(j).not.toHaveProperty('message');
    expect(j).not.toHaveProperty('recovery');
    expect(j).not.toHaveProperty('details');
  });

  it('retryable derives from recovery (immediate_retry -> true, else false)', () => {
    expect(new ToolError('FC_ENGINE_FAILED').toJSON().retryable).toBe(true);
    expect(new ToolError('FC_IO_FAILED').toJSON().retryable).toBe(true);
    expect(new ToolError('FC_SOURCE_CORRUPT').toJSON().retryable).toBe(false);
    expect(new ToolError('FC_INTERNAL_ERROR').toJSON().retryable).toBe(false);
  });

  it('classifies errno errors into canonical codes', () => {
    expect(toToolError({ code: 'ENOSPC', message: 'x' }).code).toBe('FC_IO_FAILED');
    expect(toToolError({ code: 'EACCES', message: 'x' }).code).toBe('FC_IO_FAILED');
    expect(toToolError({ code: 'EPERM', message: 'x' }).code).toBe('FC_IO_FAILED');
    expect(toToolError({ code: 'EEXIST', message: 'x' }).code).toBe('FC_OUTPUT_CONFLICT');
    expect(toToolError({ code: 'ENOENT', message: 'x' }).code).toBe('FC_INPUT_NOT_FOUND');
    expect(toToolError(new Error('boom')).code).toBe('FC_INTERNAL_ERROR');
  });

  it('public warning codes are exactly the 8 canonical FC_* codes', () => {
    expect(PUBLIC_WARNING_CODES).toHaveLength(8);
    for (const w of PUBLIC_WARNING_CODES) expect(w.startsWith('FC_')).toBe(true);
    expect(PUBLIC_WARNING_CODES).toEqual(expect.arrayContaining([
      'FC_LOSSY_REENCODE', 'FC_CMYK_NO_ICC', 'FC_ALPHA_FLATTENED', 'FC_METADATA_DROPPED',
    ]));
  });

  it('8 canonical stages', () => {
    expect(STAGES).toEqual([
      'request', 'input', 'detection', 'engine', 'output', 'resource', 'internal', 'workspace',
    ]);
  });
});
