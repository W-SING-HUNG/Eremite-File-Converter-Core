/**
 * Sharp / libvips image conversion engine.
 * In-process native library. Implements all 12 directed pairs among
 * PNG / JPEG / WebP / AVIF. Handles EXIF orientation, ICC/CMYK, alpha,
 * metadata policy, animated rejection, and Host-tightenable pixel/memory limits.
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Engine, EngineContext, EngineRunResult, ConversionPair } from './base.js';
import { TARGET_EXT } from './base.js';
import { ToolError } from '../core/errors.js';
import { LIMITS } from '../core/constants.js';
import { publicWarning } from '../core/warnings.js';
import { longPath } from '../identity/paths.js';
import {
  PROFILE_SETTINGS, resolveImageProfile, isValidImageProfile,
  type ImageProfile,
} from './image-profiles.js';
import type { Warning } from '../core/types.js';

const IMAGE_KINDS = ['png', 'jpeg', 'webp', 'avif'] as const;
type ImageKind = typeof IMAGE_KINDS[number];

let sharpModule: typeof import('sharp').default | null = null;
let sharpLoadError: Error | null = null;

async function loadSharp(): Promise<typeof import('sharp').default> {
  if (sharpModule) return sharpModule;
  if (sharpLoadError) throw sharpLoadError;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default ?? mod;
    return sharpModule;
  } catch (e) {
    sharpLoadError = e as Error;
    throw e;
  }
}

export class SharpEngine implements Engine {
  readonly id = 'sharp';
  readonly type = 'in-process-library' as const;
  readonly optional = false;

  provides(): ConversionPair[] {
    const pairs: ConversionPair[] = [];
    for (const from of IMAGE_KINDS) {
      for (const to of IMAGE_KINDS) {
        if (from !== to) pairs.push({ from, to });
      }
    }
    return pairs;
  }

  async available(): Promise<boolean> {
    try { await loadSharp(); return true; } catch { return false; }
  }

  async version(): Promise<string | null> {
    try {
      const sharp = await loadSharp();
      const v = (sharp as unknown as { versions?: Record<string, string> }).versions;
      return v ? `sharp-${v.sharp ?? '?'}/libvips-${v.vips ?? v.libvips ?? '?'}` : 'sharp-unknown';
    } catch { return null; }
  }

  async run(ctx: EngineContext): Promise<EngineRunResult> {
    const sharp = await loadSharp();
    const from = ctx.from as ImageKind;
    const to = ctx.to as ImageKind;
    const outPath = path.join(ctx.outDir, `result${TARGET_EXT[to]}`);

    if (!isValidImageProfile(ctx.profile)) throw new ToolError('FC_UNSUPPORTED_FEATURE', undefined, { field: 'profile' });
    const profile: ImageProfile = resolveImageProfile(ctx.profile);
    if (profile === 'lossless' && to === 'jpeg') {
      throw new ToolError('FC_UNSUPPORTED_FEATURE', undefined, { reason: 'lossless profile is not supported for JPEG target' });
    }

    const warnings: Warning[] = [];
    const metadataPolicy = ctx.imageOptions?.metadata ?? 'strip';
    // v1.1 supports strip-only metadata. A copyright-keeping policy was removed
    // because sharp's keep-list cannot reliably drop the GPS sub-IFD; leaving a
    // half-reliable "keep copyright" mode would violate the metadata contract.
    if (metadataPolicy !== 'strip') {
      throw new ToolError('FC_UNSUPPORTED_FEATURE', undefined, { reason: 'only strip metadata policy is supported in v1.1', metadataPolicy });
    }
    const flattenBg = ctx.imageOptions?.flattenBackground ?? '#ffffff';

    // Host-tightenable resource envelope.
    const maxPixels = ctx.limits.maxDecodedPixels;
    const maxOutputBytes = ctx.limits.maxOutputBufferBytes;

    const inputBuf = await fsp.readFile(longPath(ctx.canonicalInputPath));
    if (inputBuf.length > ctx.limits.maxSourceBytes) {
      throw new ToolError('FC_INPUT_TOO_LARGE', undefined, { bytes: inputBuf.length });
    }

    // Probe input metadata (headers only). limitInputPixels bounds decoded raster allocation.
    let meta: import('sharp').Metadata;
    try {
      meta = await sharp(inputBuf, { failOn: 'none', limitInputPixels: maxPixels }).metadata();
    } catch (e) {
      throw classifySharpError(e);
    }

    // Animated / multi-frame rejection (never silently take first frame).
    if ((meta.pages ?? 1) > 1) {
      throw new ToolError('FC_UNSUPPORTED_FEATURE', undefined, { reason: 'animated/multi-frame images are not supported', pages: meta.pages });
    }

    const w = meta.width ?? 0, h = meta.height ?? 0;
    if (w > LIMITS.imagePixels.maxEdge || h > LIMITS.imagePixels.maxEdge) {
      throw new ToolError('FC_INPUT_TOO_LARGE', undefined, { reason: 'edge exceeds hard cap', width: w, height: h });
    }
    if (w * h > maxPixels) {
      throw new ToolError('FC_INPUT_TOO_LARGE', undefined, { reason: 'decoded pixels exceed limit', pixels: w * h, limit: maxPixels });
    }

    if (meta.space === 'cmyk' && !meta.icc) warnings.push(publicWarning('FC_CMYK_NO_ICC'));

    const orientation = meta.orientation ?? 1;
    const dimsSwapped = orientation >= 5 && orientation <= 8;
    const expectedWidth = dimsSwapped ? h : w;
    const expectedHeight = dimsSwapped ? w : h;

    if (to === 'jpeg' || (profile !== 'lossless' && (to === 'webp' || to === 'avif'))) {
      warnings.push(publicWarning('FC_LOSSY_REENCODE'));
    }

    let pipe = sharp(inputBuf, { failOn: 'none', limitInputPixels: maxPixels })
      .rotate()
      .toColorspace('srgb');

    const needsFlatten = to === 'jpeg' && meta.hasAlpha === true;
    if (needsFlatten) {
      pipe = pipe.flatten({ background: flattenBg });
      warnings.push(publicWarning('FC_ALPHA_FLATTENED'));
    }

    // v1.1 metadata policy is strip-only: no withMetadata() call, so sharp
    // removes all EXIF/XMP/IPTC (including GPS) and incidental EXIF ICC data.

    const opts = PROFILE_SETTINGS[profile];
    switch (to) {
      case 'jpeg': pipe = pipe.jpeg({ ...opts.jpeg }); break;
      case 'png': pipe = pipe.png({ ...opts.png }); break;
      case 'webp': pipe = pipe.webp({ ...opts.webp }); break;
      case 'avif': pipe = pipe.avif({ ...opts.avif }); break;
    }

    let outputBuf: Buffer;
    try {
      outputBuf = await pipe.toBuffer();
    } catch (e) {
      throw classifySharpError(e);
    }
    if (outputBuf.length > maxOutputBytes) {
      throw new ToolError('FC_INPUT_TOO_LARGE', undefined, { reason: 'in-memory output buffer exceeds limit', bytes: outputBuf.length, limit: maxOutputBytes });
    }
    await fsp.writeFile(longPath(outPath), outputBuf);

    const engineVersion = (await this.version()) ?? 'sharp-unknown';
    return {
      outputPath: outPath,
      engineVersion,
      parametersProfile: { engine: 'sharp', profile, target: to, source: from, metadataPolicy, flattenBackground: needsFlatten ? flattenBg : null },
      validationHints: { expectedWidth, expectedHeight, sourceHasAlpha: meta.hasAlpha === true, sourceOrientation: orientation },
      warnings,
    };
  }
}

function classifySharpError(e: unknown): ToolError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('unsupported image format') || lower.includes('not a valid') ||
      lower.includes('premature end') || lower.includes('corrupt') || lower.includes('truncated') ||
      lower.includes('unexpected end of file') || lower.includes('decode') || lower.includes('pixel')) {
    return new ToolError('FC_SOURCE_CORRUPT');
  }
  if (lower.includes('memory') || lower.includes('limit')) return new ToolError('FC_INPUT_TOO_LARGE');
  return new ToolError('FC_ENGINE_FAILED');
}
