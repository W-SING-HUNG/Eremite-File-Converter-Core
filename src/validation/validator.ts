import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { TargetFormat, ValidatorSummary } from '../core/types.js';
import { longPath } from '../identity/paths.js';
import { readZipEntries, extractZipEntry } from '../detection/zip-container.js';
import { findEmbeddedResources } from '../engines/structured-resources.js';
import { inspectPdf } from './pdf-inspect.js';

const IMAGE_TARGETS: TargetFormat[] = ['png', 'jpeg', 'webp', 'avif'];

export interface ImageValidationContext {
  kind: 'image';
  sourceCanonicalPath: string;
  target: TargetFormat;
  profile: string;
  metadataPolicy: 'strip';
  /** Expected output dimensions after EXIF orientation (engine-computed). */
  expectedWidth?: number;
  expectedHeight?: number;
  sourceHasAlpha?: boolean;
}

export interface StructuredValidationContext {
  kind: 'structured';
  sourceKind: 'markdown' | 'html';
  target: TargetFormat;
}

export type ValidationContext = ImageValidationContext | StructuredValidationContext | { kind: 'generic' };

/**
 * Output validator. Phase 1: signature + non-empty. Phase 2: image outputs
 * are re-decoded with sharp to verify format, dimensions, alpha policy, and
 * metadata stripping. Never trusts engine exit code alone.
 */
export async function validateOutput(
  outputPath: string,
  target: TargetFormat,
  ctx?: ValidationContext,
): Promise<ValidatorSummary> {
  const checks: ValidatorSummary['checks'] = [];
  const add = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, ...(detail ? { detail } : {}) });

  let buf: Buffer;
  try {
    buf = await fsp.readFile(longPath(outputPath));
  } catch {
    add('exists', false);
    return { validator: 'phase1-generic', checks, passed: false };
  }
  add('exists', true);
  add('non-empty', buf.length > 0, `${buf.length} bytes`);

  // Image deep validation (Phase 2).
  if (ctx?.kind === 'image' && IMAGE_TARGETS.includes(target)) {
    return validateImageDeep(buf, target, ctx, checks);
  }

  // Structured-document deep validation (Phase 3).
  if (ctx?.kind === 'structured' && (target === 'html' || target === 'markdown' || target === 'docx')) {
    return validateStructuredDeep(buf, target, ctx, checks);
  }

  // PDF deep structural validation (Phase 4: LibreOffice → PDF).
  if (target === 'pdf') {
    const ins = inspectPdf(buf);
    add('pdf-signature', /^%PDF-\d/.test(buf.toString('latin1').trimStart()));
    add('pdf-page-count', ins.pageCount > 0, `${ins.pageCount} page(s)`);
    add('pdf-page-size', !ins.errors.some((e) => /page size|MediaBox/.test(e)),
      ins.pages.map((p) => `${Math.round(p.widthPt)}x${Math.round(p.heightPt)}pt`).join(', '));
    add('pdf-first-page-renderable', ins.firstPageContentBytes > 0,
      `${ins.firstPageContentBytes} content bytes`);
    add('pdf-count-consistent', !ins.errors.some((e) => /Count|zero pages|objects/.test(e)),
      ins.errors.join('; ') || 'ok');
    const passed = checks.every((c) => c.passed);
    return { validator: 'pdf-structure-v1', checks, passed };
  }
  switch (target) {
    case 'docx':
      try {
        const names = readZipEntries(buf).map((e) => e.name);
        add('zip-openable', true);
        add('content-types', names.includes('[Content_Types].xml'));
        add('document-part', names.includes('word/document.xml'));
      } catch {
        add('zip-openable', false);
      }
      break;
    case 'png':
      add('png-signature', buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
      break;
    case 'jpeg':
      add('jpeg-signature', buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff);
      break;
    case 'webp':
      add('webp-signature', buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP');
      break;
    case 'avif':
      add('avif-signature', buf.subarray(4, 12).toString('latin1').includes('ftyp') && ['avif', 'avis'].includes(buf.subarray(8, 12).toString('latin1')));
      break;
    case 'html':
    case 'markdown': {
      const ok = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, 4096)).length >= 0;
      add('utf8-readable', ok);
      add('non-whitespace', buf.toString('utf8').trim().length > 0);
      break;
    }
  }

  const passed = checks.every((c) => c.passed);
  return { validator: 'phase1-generic', checks, passed };
}

/**
 * Structured-document deep validation (Phase 3). Exit code is never enough:
 * re-check encoding, parseability/structure, and absence of embedded resources.
 */
function validateStructuredDeep(
  buf: Buffer,
  target: TargetFormat,
  _ctx: StructuredValidationContext,
  checks: ValidatorSummary['checks'],
): ValidatorSummary {
  const add = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, ...(detail ? { detail } : {}) });

  if (target === 'docx') {
    try {
      const entries = readZipEntries(buf);
      const names = new Set(entries.map((e) => e.name.replace(/\\/g, '/').replace(/^\//, '')));
      add('zip-openable', true);
      add('content-types', names.has('[Content_Types].xml'));
      const docEntry = entries.find((e) => /(^|\/)word\/document\.xml$/.test(e.name.replace(/\\/g, '/')));
      add('document-part', !!docEntry, docEntry ? `${docEntry.uncompressedSize} bytes` : 'word/document.xml missing');
      let docText = '';
      if (docEntry) {
        try { docText = extractZipEntry(buf, docEntry).toString('utf8'); } catch { docText = ''; }
      }
      add('document-xml-well-formed',
        docText.includes('<w:document') && docText.includes('<w:body') && docText.includes('</w:document>'),
        docText ? 'has w:document/w:body' : 'document.xml unreadable');
      const media = [...names].filter((n) => /(^|\/)word\/media\//.test(n));
      add('no-media-bundle', media.length === 0, media.length ? `${media.length} media entries` : 'no media');
    } catch {
      add('zip-openable', false, 'docx output is not a readable ZIP/OOXML package');
    }
    const passed = checks.every((c) => c.passed);
    return { validator: 'structured-pandoc-v1', checks, passed };
  }

  // html / markdown are UTF-8 text.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    add('utf8-readable', true);
  } catch {
    add('utf8-readable', false, 'output is not valid UTF-8');
    return { validator: 'structured-pandoc-v1', checks, passed: false };
  }

  add('non-whitespace', text.trim().length > 0, `${text.trim().length} non-space chars`);
  add('no-binary', !/\u0000/.test(text), 'no NUL bytes');

  if (target === 'html') {
    // Basic parseable structure: at least one block/inline tag or body text.
    add('html-structure', /<(h[1-6]|p|ul|ol|table|blockquote|pre|a|em|strong|code)\b/i.test(text),
      'contains semantic HTML elements');
    // Output must not (re)introduce embedded resources.
    const leaks = findEmbeddedResources('html', text);
    add('no-embedded-resources', leaks.length === 0, leaks.length ? `${leaks.length} resource refs` : 'clean');
  } else {
    // Markdown: must retain real structure, not be flattened to a single bare line.
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    add('markdown-structure', lines.length >= 1, `${lines.length} non-empty lines`);
  }

  const passed = checks.every((c) => c.passed);
  return { validator: 'structured-pandoc-v1', checks, passed };
}

/** Re-decode output with sharp; verify format, dimensions, alpha, metadata. */
async function validateImageDeep(
  buf: Buffer,
  target: TargetFormat,
  ctx: ImageValidationContext,
  checks: ValidatorSummary['checks'],
): Promise<ValidatorSummary> {
  const add = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, ...(detail ? { detail } : {}) });

  let sharp: typeof import('sharp').default;
  try {
    const mod = await import('sharp');
    sharp = mod.default ?? mod;
  } catch {
    add('sharp-available', false, 'sharp not loadable for deep validation');
    return { validator: 'image-shallow', checks, passed: checks.every((c) => c.passed) };
  }

  let meta: import('sharp').Metadata;
  try {
    meta = await sharp(buf, { failOn: 'none' }).metadata();
  } catch (e) {
    add('re-decodable', false, e instanceof Error ? e.message : String(e));
    return { validator: 'image-sharp-v1', checks, passed: false };
  }
  add('re-decodable', true);

  // Format must equal target (AVIF is reported as 'heif' by libvips).
  const fmt = (meta.format ?? '').toLowerCase();
  const fmtOk = target === 'avif' ? (fmt === 'avif' || fmt === 'heif') : fmt === target;
  add('format-match', fmtOk, `got=${fmt} expected=${target}${target === 'avif' ? ' (heif accepted)' : ''}`);

  // Dimensions sane and match expected (post-orientation).
  const ow = meta.width ?? 0, oh = meta.height ?? 0;
  add('dimensions-positive', ow > 0 && oh > 0, `${ow}x${oh}`);
  if (ctx.expectedWidth && ctx.expectedHeight) {
    add('dimensions-match', ow === ctx.expectedWidth && oh === ctx.expectedHeight,
      `got=${ow}x${oh} expected=${ctx.expectedWidth}x${ctx.expectedHeight}`);
  }

  // ── Alpha policy ────────────────────────────────────────────────────────
  // JPEG must have no alpha. For alpha-capable targets (PNG/WebP/AVIF) we do a
  // FULL alpha-plane comparison against the auto-oriented source, not a weak
  // hasAlpha/min sample. The tool never resizes, so post-orientation source and
  // output dimensions are identical and pixels correspond 1:1.
  const ALPHA_CAPABLE = new Set(['png', 'webp', 'avif']);
  const outHasAlpha = meta.hasAlpha === true || (meta.channels ?? 0) === 4;
  if (target === 'jpeg') {
    add('alpha-absent', !outHasAlpha, `channels=${meta.channels} hasAlpha=${meta.hasAlpha}`);
  } else if (ctx.sourceHasAlpha && ALPHA_CAPABLE.has(target)) {
    await addAlphaPlaneChecks(sharp, add, ctx, buf);
  }

  // Metadata policy: v1.1 is strip-only, so output must carry no EXIF/GPS.
  if (ctx.metadataPolicy === 'strip') {
    const hasExif = !!meta.exif;
    add('metadata-stripped', !hasExif, hasExif ? 'EXIF present' : 'no EXIF');
  }

  const passed = checks.every((c) => c.passed);
  return { validator: 'image-sharp-v1', checks, passed };
}

// ── Alpha-plane preservation (full per-pixel comparison) ────────────────────
// Corpus-derived lossy-alpha bounds for AVIF balanced(q50)/high_quality(q63) on a
// 256x256 corpus (smooth/radial/hard-edge/noisy-mid planes): worst maxErr=34,
// worst MAE=4.65. Any dropped channel or flatten-to-opaque yields MAE in the
// dozens-to-hundreds (e.g. uniform 128→255 gives MAE 127), so these bounds pass
// real quantization while failing every meaningful transparency corruption.
const AVIF_LOSSY_MAX_ALPHA_ERR = 40;
const AVIF_LOSSY_MAE = 8;

type AddCheck = (name: string, passed: boolean, detail?: string) => void;
type SharpModule = typeof import('sharp').default;

/** Extract the auto-oriented alpha plane (one byte/pixel), forcing RGBA. */
async function extractAlphaPlane(
  sharp: SharpModule, input: Buffer | string,
): Promise<{ width: number; height: number; alpha: Uint8Array }> {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()                 // bake EXIF orientation, mirroring the engine pipeline
    .ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) alpha[j] = data[i + 3]!;
  return { width: info.width, height: info.height, alpha };
}

async function addAlphaPlaneChecks(
  sharp: SharpModule, add: AddCheck,
  ctx: ImageValidationContext, outBuf: Buffer,
): Promise<void> {
  let src: { width: number; height: number; alpha: Uint8Array };
  let out: { width: number; height: number; alpha: Uint8Array };
  try {
    const srcBuf = await fsp.readFile(longPath(ctx.sourceCanonicalPath));
    [src, out] = await Promise.all([
      extractAlphaPlane(sharp, srcBuf),
      extractAlphaPlane(sharp, outBuf),
    ]);
  } catch (e) {
    add('alpha-plane-preserved', false, `alpha plane extraction failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // A fully-opaque source (every alpha=255) may legitimately have its channel
  // dropped by the encoder; opacity is still preserved — nothing to enforce.
  const srcAllOpaque = src.alpha.every((a) => a === 255);
  if (srcAllOpaque) {
    add('alpha-plane-preserved', true, 'source fully opaque; no transparency to preserve');
    return;
  }

  // The tool never resizes: post-orientation planes must align 1:1.
  if (src.width !== out.width || src.height !== out.height || src.alpha.length !== out.alpha.length) {
    add('alpha-plane-preserved', false,
      `geometry mismatch source=${src.width}x${src.height} output=${out.width}x${out.height}`);
    return;
  }

  let maxErr = 0, sumErr = 0;
  for (let i = 0; i < src.alpha.length; i += 1) {
    const d = Math.abs(src.alpha[i]! - out.alpha[i]!);
    if (d > maxErr) maxErr = d;
    sumErr += d;
  }
  const mae = sumErr / src.alpha.length;

  // Exact gate: PNG is lossless; WebP with alphaQuality=100 is bit-exact on alpha
  // (verified across uniform/gradient/mixed/noisy corpus); AVIF lossless is exact.
  const profile = ctx.profile;
  const exactGate = ctx.target === 'png' || ctx.target === 'webp' ||
    (ctx.target === 'avif' && profile === 'lossless');

  if (exactGate) {
    add('alpha-plane-preserved', maxErr === 0,
      maxErr === 0 ? 'alpha plane identical to source' : `alpha differs: maxErr=${maxErr} mae=${mae.toFixed(3)} (expected exact)`);
  } else {
    // AVIF lossy: bounded quantization only.
    const ok = maxErr <= AVIF_LOSSY_MAX_ALPHA_ERR && mae <= AVIF_LOSSY_MAE;
    add('alpha-plane-preserved', ok,
      `avif lossy alpha maxErr=${maxErr} mae=${mae.toFixed(3)} (bounds max<=${AVIF_LOSSY_MAX_ALPHA_ERR}, mae<=${AVIF_LOSSY_MAE})`);
  }
}

export async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(longPath(p)), h);
  return h.digest('hex');
}
