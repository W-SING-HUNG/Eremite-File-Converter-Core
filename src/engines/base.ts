import type { SourceKind, TargetFormat, Warning, ImageOptions } from '../core/types.js';
import type { RealTypeInfo } from '../core/types.js';

export interface ConversionPair {
  from: SourceKind;
  to: TargetFormat;
}

/** Effective per-invocation limits (Host envelope clamped onto built-in caps). */
export interface EffectiveLimits {
  maxSourceBytes: number;
  timeoutMs: number;
  maxDecodedPixels: number;
  maxOutputBufferBytes: number;
}

export interface EngineContext extends ConversionPair {
  operationId: string;
  canonicalInputPath: string;
  workDir: string;
  outDir: string;
  logsDir: string;
  profile: string;
  limits: EffectiveLimits;
  imageOptions?: ImageOptions;
}

export interface EngineRunResult {
  outputPath: string;
  engineVersion: string;
  parametersProfile: Record<string, unknown>;
  warnings: Warning[];
  /** Engine-provided hints for the output validator (e.g. expected post-orientation dimensions). */
  validationHints?: Record<string, unknown>;
  /** DEV/QA-only raw diagnostics (stderr tails etc.); never serialized into a public response. */
  diagnostics?: Record<string, unknown>;
}

export interface Engine {
  readonly id: string;
  /** v1.1 has exactly two engine kinds: sharp is in-process, pandoc/libreoffice are subprocesses. */
  readonly type: 'in-process-library' | 'subprocess-executable';
  readonly optional: boolean;
  provides(): ConversionPair[];
  available(): Promise<boolean>;
  version(): Promise<string | null>;
  run(ctx: EngineContext): Promise<EngineRunResult>;
}

export const TARGET_EXT: Record<TargetFormat, string> = {
  pdf: '.pdf',
  html: '.html',
  markdown: '.md',
  docx: '.docx',
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  avif: '.avif',
};

const IMAGE_TARGETS: TargetFormat[] = ['png', 'jpeg', 'webp', 'avif'];

/** Legal targets per v1.1 (18 accepted pairs). */
export function legalTargetsFor(kind: SourceKind): TargetFormat[] {
  switch (kind) {
    case 'docx': return ['pdf'];
    case 'xlsx': return ['pdf'];
    case 'pptx': return ['pdf'];
    case 'markdown': return ['html', 'docx'];
    case 'html': return ['markdown'];
    case 'png': case 'jpeg': case 'webp': case 'avif':
      return IMAGE_TARGETS.filter((t) => t !== kind) as TargetFormat[];
    default: return [];
  }
}

export function isLegalPair(from: SourceKind, to: TargetFormat): boolean {
  return legalTargetsFor(from).includes(to);
}

export type { RealTypeInfo };
