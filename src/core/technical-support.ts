/**
 * Core technical-support metadata (Host Contract v1.1).
 *
 * NON-authoritative Core technical metadata only. This is NOT Host policy and
 * does NOT import any authority JSON. The Core uses it to judge whether IT can
 * technically execute a given (from,to,engine) triple. Host authorization /
 * capability allow-lists are the Host's responsibility and live outside the Core.
 *
 * Exactly 18 directed conversions are technically supported in v1.1, built from
 * the three production engines:
 *   - sharp:    all 12 image pairs among png/jpeg/webp/avif
 *   - pandoc:   markdown-to-html, html-to-markdown, markdown-to-docx
 *   - libreoffice: docx-to-pdf, xlsx-to-pdf, pptx-to-pdf
 *
 * A conversionId is an OPAQUE stable identifier spelled `<source>-to-<target>`
 * (canonical-compatible: it must satisfy the contract's
 * `^[a-z0-9][a-z0-9.-]{0,95}$` pattern). The (source,target) mapping is
 * maintained EXPLICITLY by this registry and is never derived by parsing the id.
 *
 * v1.1 has NO runtime fallback engine: assertTechnicallySupported rejects any
 * plan that names a fallback engine.
 */
import { ToolError } from './errors.js';
import type { SourceKind, TargetFormat } from './types.js';

export interface TechnicalConversion {
  id: string;
  from: SourceKind;
  to: TargetFormat;
  engine: 'sharp' | 'pandoc' | 'libreoffice';
  defaultProfile: string;
}

const IMAGE_KINDS = ['png', 'jpeg', 'webp', 'avif'] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];

function imageConversions(): TechnicalConversion[] {
  const out: TechnicalConversion[] = [];
  for (const a of IMAGE_KINDS) {
    for (const b of IMAGE_KINDS) {
      if (a !== b) out.push({ id: `${a}-to-${b}`, from: a, to: b, engine: 'sharp', defaultProfile: 'balanced' });
    }
  }
  return out;
}

export const TECHNICAL_CONVERSIONS: TechnicalConversion[] = [
  ...imageConversions(),
  { id: 'markdown-to-html', from: 'markdown', to: 'html', engine: 'pandoc', defaultProfile: 'standard' },
  { id: 'html-to-markdown', from: 'html', to: 'markdown', engine: 'pandoc', defaultProfile: 'standard' },
  { id: 'markdown-to-docx', from: 'markdown', to: 'docx', engine: 'pandoc', defaultProfile: 'standard' },
  { id: 'docx-to-pdf', from: 'docx', to: 'pdf', engine: 'libreoffice', defaultProfile: 'standard' },
  { id: 'xlsx-to-pdf', from: 'xlsx', to: 'pdf', engine: 'libreoffice', defaultProfile: 'standard' },
  { id: 'pptx-to-pdf', from: 'pptx', to: 'pdf', engine: 'libreoffice', defaultProfile: 'standard' },
];

const BY_ID = new Map<string, TechnicalConversion>(TECHNICAL_CONVERSIONS.map((c) => [c.id, c]));

/**
 * Canonical conversionId spelling: `<source>-to-<target>`.
 *
 * The id is an OPAQUE stable identifier. Callers must NEVER parse/split it to
 * derive source or target — resolve it through `lookupTechnical()` instead.
 */
export function conversionIdFor(from: SourceKind, to: TargetFormat): string {
  return `${from}-to-${to}`;
}

export function lookupTechnical(id: string): TechnicalConversion | undefined {
  return BY_ID.get(id);
}

/**
 * Validate a conversion plan against Core's technical capability. Throws stable
 * FC_* errors on any deviation. Does NOT consult Host authority.
 */
export function assertTechnicallySupported(
  conversionId: string,
  targetFormatId: TargetFormat,
  engineId: string,
  fallbackEngineId: string | null,
): { from: SourceKind; to: TargetFormat; engineId: string } {
  // conversionId is an OPAQUE stable identifier: source/target come from the
  // registry, never from splitting the string.
  const tech = BY_ID.get(conversionId);
  if (!tech || tech.engine !== engineId) {
    // The engine must technically provide (from,to).
    throw new ToolError('FC_UNSUPPORTED_FEATURE');
  }
  if (tech.to !== targetFormatId) throw new ToolError('FC_TARGET_UNSUPPORTED');

  // v1.1 has no runtime fallback engine.
  if (fallbackEngineId) throw new ToolError('FC_UNSUPPORTED_FEATURE');

  return { from: tech.from, to: tech.to, engineId: tech.engine };
}
