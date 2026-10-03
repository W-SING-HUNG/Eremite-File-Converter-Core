/**
 * Frozen-format metadata (canonical Host Contract v1.1).
 *
 * Pure data used to fill the `{ formatId, mediaType, extension }` triples that
 * appear in the canonical wire contract. NOT capability policy — it only
 * describes how a SourceKind / TargetFormat is named on the wire.
 *
 * `extension` MUST include the leading dot to satisfy the canonical pattern
 * `^\.[a-z0-9]{1,16}$`.
 */
import type { SourceKind, TargetFormat } from './types.js';

export type AnyFormat = SourceKind | TargetFormat;

export const FORMAT_MEDIA: Record<AnyFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  html: 'text/html',
  markdown: 'text/markdown',
};

export const FORMAT_EXT: Record<AnyFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  avif: '.avif',
  docx: '.docx',
  xlsx: '.xlsx',
  pptx: '.pptx',
  pdf: '.pdf',
  html: '.html',
  markdown: '.md',
};

export interface FormatTriple {
  formatId: string;
  mediaType: string;
  extension: string;
}

/** Build the canonical `{ formatId, mediaType, extension }` triple for a kind. */
export function fmt(kind: AnyFormat): FormatTriple {
  return { formatId: kind, mediaType: FORMAT_MEDIA[kind], extension: FORMAT_EXT[kind] };
}
