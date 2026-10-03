import { randomUUID } from 'node:crypto';
import { ToolError } from '../core/errors.js';

/**
 * Strict UUID acceptance, case-insensitive.
 *
 * Canonical v1.1 requires the Host `invocationId` to accept **UUIDv7** in
 * addition to v1-v5, so the version nibble accepts 1-7 (variant 8/9/a/b).
 * Anything looser (missing dashes, wrong length, non-hex) stays invalid.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidOperationId(id: string): boolean {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Validate a supplied id or generate a fresh UUIDv4. Never returns attacker-controlled path material. */
export function resolveOperationId(supplied: string | undefined): string {
  if (supplied === undefined) return randomUUID();
  if (!isValidOperationId(supplied)) {
    throw new ToolError('FC_INVALID_REQUEST', 'operationId must be a strict UUID', { supplied: typeof supplied });
  }
  return supplied.toLowerCase();
}

/**
 * Defense in depth: even after UUID validation, an id used in a path must
 * survive a basename round-trip and contain no separator / traversal.
 */
export function assertOperationIdPathSafe(id: string): void {
  if (id !== id.replace(/[\\/]/g, '') || id.includes('..') || id !== id.split(/[\\/]/).pop()) {
    throw new ToolError('FC_INVALID_REQUEST', 'operationId is not path-safe');
  }
}
