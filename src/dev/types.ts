/**
 * DEV-only types. NOT part of the frozen production Host Contract v1.1 surface
 * and therefore excluded from the published package type declarations. The
 * production protocol (request / success / failure responses) lives in
 * ../core/types.ts; these types back the legacy in-process DEV convert() helper
 * and the QA backend only.
 */
import type { ErrorCode, RecoverySemantic } from '../core/errors.js';
import type {
  RealTypeInfo, TargetFormat, Warning, ImageOptions, ValidatorSummary, CompactProvenance,
} from '../core/types.js';

/** DEV-only conflict mode for the legacy self-managed convert() helper. Production has no versioning. */
export type ConflictMode = 'reject' | 'version';

/** DEV-only request shape (legacy fc-cli convert / QA backend). Not the production protocol. */
export interface ConvertRequest {
  sourcePath: string;
  targetFormat: TargetFormat;
  profile?: string;
  output: {
    directory: string;
    filename?: string;
    conflict?: ConflictMode;
  };
  enginePolicy?: {
    preferred?: 'auto' | 'libreoffice' | 'pandoc' | 'sharp';
    onRuntimeFailure?: 'fail' | 'fallback';
  };
  imageOptions?: ImageOptions;
  timeoutMs?: number;
  /** Must be a strict UUID; core generates one when omitted. */
  operationId?: string;
}

/** DEV-only error DTO (richer than the frozen public ErrorDTO). */
export interface ToolErrorDTO {
  code: ErrorCode;
  message: string;
  recovery: RecoverySemantic;
  details?: Record<string, unknown>;
}

export type ConvertResult =
  | {
      status: 'succeeded';
      operationId: string;
      detectedSourceType: RealTypeInfo;
      targetFormat: TargetFormat;
      output: { path: string; sizeBytes: number; sha256: string };
      engine: { actual: string; actualVersion: string };
      profile: string;
      warnings: Warning[];
      totalWarningCount: number;
      source: { sizeBytes: number; sha256: string };
      timing: { startedAt: string; endedAt: string; durationMs: number };
      validation: ValidatorSummary;
      provenance: CompactProvenance;
    }
  | {
      status: 'failed';
      operationId: string;
      detectedSourceType?: RealTypeInfo;
      error: ToolErrorDTO;
      engine?: { actual?: string };
      timing: { startedAt: string; endedAt: string; durationMs: number };
      warnings: Warning[];
      provenance: CompactProvenance;
    };
