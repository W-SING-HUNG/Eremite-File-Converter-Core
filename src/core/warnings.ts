/**
 * Canonical public WARNING taxonomy — Host Contract v1.1 (canonical
 * tool-contract-v1.1.json). Exactly these 8 codes may appear in a public
 * response, and a warning carries ONLY `code`.
 *
 * Raw engine/Pandoc/LibreOffice text is never attached to a public warning —
 * it lives in the DEV/QA diagnostics sink.
 */
export type WarningCode =
  | 'FC_DECLARED_TYPE_MISMATCH'
  | 'FC_EXTENSION_MISMATCH'
  | 'FC_FALLBACK_USED'
  | 'FC_METADATA_DROPPED'
  | 'FC_OUTPUT_NORMALIZED'
  | 'FC_LOSSY_REENCODE'
  | 'FC_CMYK_NO_ICC'
  | 'FC_ALPHA_FLATTENED';

/** Frozen canonical warning enum (in canonical declaration order). */
export const PUBLIC_WARNING_CODES: readonly WarningCode[] = [
  'FC_DECLARED_TYPE_MISMATCH',
  'FC_EXTENSION_MISMATCH',
  'FC_FALLBACK_USED',
  'FC_METADATA_DROPPED',
  'FC_OUTPUT_NORMALIZED',
  'FC_LOSSY_REENCODE',
  'FC_CMYK_NO_ICC',
  'FC_ALPHA_FLATTENED',
];

/** Internal, implementation-neutral descriptions (never serialized into a response). */
export const WARNING_MESSAGE: Record<WarningCode, string> = {
  FC_DECLARED_TYPE_MISMATCH: 'the declared media type did not match the detected real type; the detected type was used',
  FC_EXTENSION_MISMATCH: 'the file extension does not match the detected real type; the detected type was used',
  FC_FALLBACK_USED: 'a fallback engine was used because the primary engine could not complete the conversion',
  FC_METADATA_DROPPED: 'metadata (EXIF/XMP/IPTC, including location and copyright) was removed by the strip policy',
  FC_OUTPUT_NORMALIZED: 'the output was normalized by the engine (formatting/structure may differ cosmetically)',
  FC_LOSSY_REENCODE: 'the output uses lossy compression, so it is not byte-identical to the source',
  FC_CMYK_NO_ICC: 'a CMYK source without an ICC profile was converted with a default transform; color may differ slightly',
  FC_ALPHA_FLATTENED: 'transparency was flattened onto a background because the target format has no alpha channel',
};

/** Canonical public warning DTO — `{ code }` only. */
export function publicWarning(code: WarningCode): { code: WarningCode } {
  return { code };
}
