import type { ErrorDTO } from './errors.js';
import type { WarningCode } from './warnings.js';

export type SourceKind =
  | 'docx' | 'xlsx' | 'pptx'
  | 'markdown' | 'html'
  | 'png' | 'jpeg' | 'webp' | 'avif';

export type TargetFormat = 'pdf' | 'html' | 'markdown' | 'docx' | 'png' | 'jpeg' | 'webp' | 'avif';

export interface ImageOptions {
  flattenBackground?: `#${string}`;
  /** v1.1 is strip-only: all EXIF/XMP/IPTC (incl. GPS and copyright) are removed. */
  metadata?: 'strip';
}

/** FROZEN public warning: code only. Raw engine text is never attached. */
export interface Warning {
  code: WarningCode;
}

export interface RealTypeInfo {
  kind: SourceKind | 'unknown';
  extensionHint: string | null;
  signals: {
    extension: string | null;
    magic: string | null;
    container: 'ooxml' | 'cfb' | 'none' | null;
  };
  warnings: Warning[];
}

export interface EngineInfo {
  id: string;
  /** v1.1 has exactly two engine kinds: sharp is in-process, pandoc/libreoffice are subprocesses. */
  type: 'in-process-library' | 'subprocess-executable';
  found: boolean;
  version: string | null;
  executablePath: string | null;
  provides: string[];
  optional: boolean;
}

export interface Capabilities {
  runtime: { node: string; platform: string; baseline: 'node-24-lts' };
  engines: EngineInfo[];
  /** Conversion pairs actually runnable on this machine right now (environment report only). */
  availableConversions: Array<{ from: SourceKind; to: TargetFormat; engine: string }>;
}

export interface ValidatorSummary {
  validator: string;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  passed: boolean;
}

export interface CompactProvenance {
  schemaVersion: '1.1';
  invocationId: string;
  conversionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  conversion: { source: string; target: TargetFormat; profile: string };
  source: { realType: string; sizeBytes: number; sha256: string };
  output?: { sizeBytes: number; sha256: string; validator: string };
  engine: {
    actual: string | null;
    actualVersion: string | null;
  };
  warnings: string[];
  errorCode?: import('./errors.js').ErrorCode;
  tool: { name: string; version: string; runtime: string };
}

// ── Host Contract v1.1 (frozen production protocol) ─────────────────────────

export interface HostWorkspace {
  rootPath: string;
  inputPath: string;   // fixed source path inside workspace
  outputPath: string;  // fixed output path inside workspace
}

export interface HostSource {
  displayName: string;
  declaredMediaType: string;
  byteSize: number;
  sha256: string;
}

export interface HostTarget {
  formatId: TargetFormat;
  mediaType: string;
  extension: string;
}

export interface HostEnginePlan {
  primaryEngineId: 'sharp' | 'pandoc' | 'libreoffice';
  fallbackEngineId: string | null; // v1.1 has NO fallback -> must be null
}

export interface HostLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxWorkspaceBytes: number;
  timeoutMs: number;
}

export interface HostInvocationRequest {
  kind: 'request';
  contractVersion: 1;
  invocationId: string; // strict UUID
  workspace: HostWorkspace;
  source: HostSource;
  conversion: {
    conversionId: string;            // e.g. "png-to-jpeg"
    target: HostTarget;
    enginePlan: HostEnginePlan;
  };
  limits: HostLimits;
}

export interface FormatTriple { formatId: string; mediaType: string; extension: string; }

/**
 * Canonical top-level `fallback` object (NOT inside `engine`).
 * v1.1 has no runtime fallback engine, so Core always emits `{ used: false }`.
 */
export type HostFallback =
  | { used: false }
  | { used: true; primaryEngineId: string; reasonCode: 'PRIMARY_UNAVAILABLE' | 'PRIMARY_INCOMPATIBLE' | 'PRIMARY_FAILED' };

export interface HostSuccessResponse {
  kind: 'response';
  contractVersion: 1;
  invocationId: string;
  status: 'succeeded';
  coreVersion: string;
  sourceSha256: string;
  detectedSource: FormatTriple;
  target: FormatTriple;
  output: { byteSize: number; sha256: string; detectedType: FormatTriple };
  /** Canonical engine object: id + version ONLY. */
  engine: { id: string; version: string };
  /** Canonical top-level fallback object. */
  fallback: HostFallback;
  durationMs: number;
  warnings: Warning[];
}

export interface HostFailureResponse {
  kind: 'response';
  contractVersion: 1;
  invocationId: string;
  status: 'failed';
  coreVersion: string;
  durationMs: number;
  warnings: Warning[];
  errors: ErrorDTO[];
}

export type HostInvocationResponse = HostSuccessResponse | HostFailureResponse;
