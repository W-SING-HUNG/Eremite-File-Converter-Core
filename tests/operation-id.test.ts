import { describe, it, expect } from 'vitest';
import { isValidOperationId, resolveOperationId, assertOperationIdPathSafe } from '../src/identity/operation-id.js';
import { ToolError } from '../src/core/errors.js';

describe('operationId policy', () => {
  it('accepts canonical UUIDs', () => {
    expect(isValidOperationId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });
  it('rejects non-UUID caller input', () => {
    expect(isValidOperationId('../../../etc/passwd')).toBe(false);
    expect(isValidOperationId('abc')).toBe(false);
    expect(() => resolveOperationId('not-a-uuid')).toThrow(ToolError);
  });
  it('generates UUIDv4 when omitted', () => {
    expect(isValidOperationId(resolveOperationId(undefined))).toBe(true);
  });
  it('never participates in path interpretation', () => {
    expect(() => assertOperationIdPathSafe('123e4567-e89b-42d3-a456-426614174000')).not.toThrow();
    expect(() => assertOperationIdPathSafe('..')).toThrow();
  });
});
