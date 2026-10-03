/**
 * Canonical public taxonomy — Host Contract v1.1 (authority-signed canonical
 * tool-contract-v1.1.json). These FC_* codes and stage names ARE the single
 * public taxonomy used end to end; there is no second/legacy taxonomy and no
 * old-code -> new-code adapter layer.
 *
 * Public `retryable` is derived: retryable = (recovery === 'immediate_retry').
 *
 * Raw engine text (LibreOffice stderr, Pandoc notices, stack traces, paths,
 * command lines) never travels in a public response; it is confined to the
 * DEV/QA diagnostics channel only.
 */
export type RecoverySemantic = 'immediate_retry' | 'after_user_action' | 'never';

/** Canonical v1.1 error codes (32) — exactly the canonical enum. */
export type ErrorCode =
  | 'FC_INVALID_REQUEST'
  | 'FC_INPUT_NOT_FOUND'
  | 'FC_INPUT_NOT_REGULAR_FILE'
  | 'FC_INPUT_TOO_LARGE'
  | 'FC_INPUT_SIZE_MISMATCH'
  | 'FC_INPUT_HASH_MISMATCH'
  | 'FC_SOURCE_UNSUPPORTED'
  | 'FC_SOURCE_CORRUPT'
  | 'FC_TARGET_UNSUPPORTED'
  | 'FC_CONVERSION_UNSUPPORTED'
  | 'FC_DEPENDENCY_MISSING'
  | 'FC_DEPENDENCY_INCOMPATIBLE'
  | 'FC_ENGINE_START_FAILED'
  | 'FC_ENGINE_FAILED'
  | 'FC_TIMEOUT'
  | 'FC_RESOURCE_LIMIT'
  | 'FC_OUTPUT_MISSING'
  | 'FC_OUTPUT_NOT_REGULAR_FILE'
  | 'FC_OUTPUT_EMPTY'
  | 'FC_OUTPUT_TOO_LARGE'
  | 'FC_OUTPUT_TYPE_MISMATCH'
  | 'FC_OUTPUT_VALIDATION_FAILED'
  | 'FC_IO_FAILED'
  | 'FC_INTERNAL_ERROR'
  | 'FC_UNSAFE_INPUT_PATH'
  | 'FC_SOURCE_CHANGED'
  | 'FC_ENCRYPTED_PROTECTED'
  | 'FC_MACRO_UNSUPPORTED'
  | 'FC_EXTERNAL_REL_BLOCKED'
  | 'FC_RESOURCE_BUNDLE_REQUIRED'
  | 'FC_OUTPUT_CONFLICT'
  | 'FC_UNSUPPORTED_FEATURE';

/** Canonical v1.1 stages (8) — exactly the canonical enum. */
export type Stage =
  | 'request'
  | 'input'
  | 'detection'
  | 'engine'
  | 'output'
  | 'resource'
  | 'internal'
  | 'workspace';

export const RECOVERY: Record<ErrorCode, RecoverySemantic> = {
  FC_INVALID_REQUEST: 'never',
  FC_INPUT_NOT_FOUND: 'after_user_action',
  FC_INPUT_NOT_REGULAR_FILE: 'after_user_action',
  FC_INPUT_TOO_LARGE: 'after_user_action',
  FC_INPUT_SIZE_MISMATCH: 'immediate_retry',
  FC_INPUT_HASH_MISMATCH: 'immediate_retry',
  FC_SOURCE_UNSUPPORTED: 'never',
  FC_SOURCE_CORRUPT: 'never',
  FC_TARGET_UNSUPPORTED: 'never',
  FC_CONVERSION_UNSUPPORTED: 'never',
  FC_DEPENDENCY_MISSING: 'after_user_action',
  FC_DEPENDENCY_INCOMPATIBLE: 'after_user_action',
  FC_ENGINE_START_FAILED: 'immediate_retry',
  FC_ENGINE_FAILED: 'immediate_retry',
  FC_TIMEOUT: 'immediate_retry',
  FC_RESOURCE_LIMIT: 'after_user_action',
  FC_OUTPUT_MISSING: 'immediate_retry',
  FC_OUTPUT_NOT_REGULAR_FILE: 'immediate_retry',
  FC_OUTPUT_EMPTY: 'immediate_retry',
  FC_OUTPUT_TOO_LARGE: 'after_user_action',
  FC_OUTPUT_TYPE_MISMATCH: 'never',
  FC_OUTPUT_VALIDATION_FAILED: 'never',
  FC_IO_FAILED: 'immediate_retry',
  FC_INTERNAL_ERROR: 'never',
  FC_UNSAFE_INPUT_PATH: 'after_user_action',
  FC_SOURCE_CHANGED: 'immediate_retry',
  FC_ENCRYPTED_PROTECTED: 'after_user_action',
  FC_MACRO_UNSUPPORTED: 'after_user_action',
  FC_EXTERNAL_REL_BLOCKED: 'after_user_action',
  FC_RESOURCE_BUNDLE_REQUIRED: 'after_user_action',
  FC_OUTPUT_CONFLICT: 'after_user_action',
  FC_UNSUPPORTED_FEATURE: 'after_user_action',
};

export const ERROR_CODES = Object.keys(RECOVERY) as ErrorCode[];

export const STAGES: readonly Stage[] = [
  'request', 'input', 'detection', 'engine', 'output', 'resource', 'internal', 'workspace',
];

/** Stable, implementation-neutral internal messages — NEVER serialized into a public response. */
export const PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  FC_INVALID_REQUEST: 'the invocation request is malformed',
  FC_INPUT_NOT_FOUND: 'the input file does not exist',
  FC_INPUT_NOT_REGULAR_FILE: 'the input is not a regular file',
  FC_INPUT_TOO_LARGE: 'the input exceeds an enforced size limit',
  FC_INPUT_SIZE_MISMATCH: 'the input byte size does not match the declared value',
  FC_INPUT_HASH_MISMATCH: 'the input hash does not match the declared value',
  FC_SOURCE_UNSUPPORTED: 'the source type is not supported',
  FC_SOURCE_CORRUPT: 'the source file is malformed, corrupt or unsafe',
  FC_TARGET_UNSUPPORTED: 'the requested target format is not supported',
  FC_CONVERSION_UNSUPPORTED: 'the requested conversion is not supported',
  FC_DEPENDENCY_MISSING: 'a required conversion engine/dependency is not available',
  FC_DEPENDENCY_INCOMPATIBLE: 'the available engine version is incompatible',
  FC_ENGINE_START_FAILED: 'the engine process could not be started',
  FC_ENGINE_FAILED: 'the engine failed during conversion',
  FC_TIMEOUT: 'the conversion exceeded its time limit',
  FC_RESOURCE_LIMIT: 'a decoded-resource or memory limit was exceeded',
  FC_OUTPUT_MISSING: 'the engine produced no output file',
  FC_OUTPUT_NOT_REGULAR_FILE: 'the produced output is not a regular file',
  FC_OUTPUT_EMPTY: 'the produced output is empty',
  FC_OUTPUT_TOO_LARGE: 'the produced output exceeds the limit',
  FC_OUTPUT_TYPE_MISMATCH: 'the produced output type does not match the target',
  FC_OUTPUT_VALIDATION_FAILED: 'the converted output failed validation',
  FC_IO_FAILED: 'a filesystem or I/O operation failed',
  FC_INTERNAL_ERROR: 'an internal error occurred',
  FC_UNSAFE_INPUT_PATH: 'the path is unsafe (symlink, reparse point, UNC, or outside the workspace)',
  FC_SOURCE_CHANGED: 'the source changed while being read, or its hash/size does not match',
  FC_ENCRYPTED_PROTECTED: 'encrypted or password-protected files are not supported',
  FC_MACRO_UNSUPPORTED: 'macro-enabled documents are not supported',
  FC_EXTERNAL_REL_BLOCKED: 'the document references a blocked external relationship/resource',
  FC_RESOURCE_BUNDLE_REQUIRED: 'the document needs a resource bundle, unsupported by the single-file contract',
  FC_OUTPUT_CONFLICT: 'the fixed output path already exists and was not overwritten',
  FC_UNSUPPORTED_FEATURE: 'the requested feature or profile is not supported for this conversion',
};

/** Canonical public error DTO — exactly { code, stage, retryable }. */
export interface ErrorDTO {
  code: ErrorCode;
  stage: Stage;
  retryable: boolean;
}

export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly recovery: RecoverySemantic;
  readonly stage: Stage;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>, stage: Stage = 'internal') {
    super(message ?? PUBLIC_MESSAGE[code]);
    this.name = 'ToolError';
    this.code = code;
    this.recovery = RECOVERY[code];
    this.stage = stage;
    this.details = details;
  }

  /**
   * Public DTO — canonical shape only. No message / recovery / details / stack /
   * path / stderr / command ever appear in a public response.
   */
  toJSON(): ErrorDTO {
    return {
      code: this.code,
      stage: this.stage,
      retryable: this.recovery === 'immediate_retry',
    };
  }
}

/** Wrap an unknown thrown value; classify common fs errors without leaking internals. */
export function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  const e = err as NodeJS.ErrnoException;
  if (e && typeof e.code === 'string') {
    if (e.code === 'ENOSPC') return new ToolError('FC_IO_FAILED', undefined, undefined, 'output');
    if (e.code === 'EACCES' || e.code === 'EPERM') return new ToolError('FC_IO_FAILED', undefined, undefined, 'output');
    if (e.code === 'EEXIST') return new ToolError('FC_OUTPUT_CONFLICT', undefined, undefined, 'output');
    if (e.code === 'ENOENT') return new ToolError('FC_INPUT_NOT_FOUND', undefined, undefined, 'input');
  }
  return new ToolError('FC_INTERNAL_ERROR');
}
