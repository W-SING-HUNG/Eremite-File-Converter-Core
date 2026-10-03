/**
 * Phase 2 — Sharp image conversion tests.
 * All 12 directed pairs among PNG/JPEG/WebP/AVIF, 3 profiles, edge cases.
 * Fixtures are generated at runtime with sharp and written to tmp dirs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp, { type Sharp } from 'sharp';
import { createDevConverter } from '../src/dev/api.js';
import { sha256File } from '../src/validation/validator.js';

const IMAGE_KINDS = ['png', 'jpeg', 'webp', 'avif'] as const;
type ImageKind = typeof IMAGE_KINDS[number];

const EXT: Record<ImageKind, string> = { png: '.png', jpeg: '.jpg', webp: '.webp', avif: '.avif' };

let tmpRoot: string;
let outDir: string;
let converter: ReturnType<typeof createDevConverter>;

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-img-test-'));
  outDir = path.join(tmpRoot, 'out');
  await fsp.mkdir(outDir, { recursive: true });
  converter = createDevConverter();
});

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

/** Generate a small test image of the given kind. Returns file path.
 *  Alpha images use VARYING alpha values (0/80/180/255 cycle) — realistic
 *  transparent content, not uniform alpha which libvips may optimize away. */
async function genImage(kind: ImageKind, opts: { alpha?: boolean; width?: number; height?: number } = {}): Promise<string> {
  const w = opts.width ?? 40, h = opts.height ?? 30;
  const p = path.join(tmpRoot, `src-${kind}-${opts.alpha ? 'a' : 'o'}-${w}x${h}${EXT[kind]}`);
  let pipe: Sharp;
  if (opts.alpha) {
    // Raw RGBA with varying alpha: columns cycle 0/80/180/255 so the image
    // genuinely contains transparent, semi-transparent, and opaque pixels.
    const raw = Buffer.alloc(w * h * 4);
    const alphaCycle: number[] = [0, 80, 180, 255];
    for (let i = 0; i < w * h; i++) {
      raw[i * 4] = 200; raw[i * 4 + 1] = 60; raw[i * 4 + 2] = 120;
      raw[i * 4 + 3] = alphaCycle[i % 4]!;
    }
    pipe = sharp(raw, { raw: { width: w, height: h, channels: 4 } });
  } else {
    pipe = sharp({ create: { width: w, height: h, channels: 3, background: { r: 100, g: 150, b: 200, alpha: 1 } } });
  }
  switch (kind) {
    case 'png': await pipe.png().toFile(p); break;
    case 'jpeg': await pipe.jpeg({ quality: 90 }).toFile(p); break;
    case 'webp': await pipe.webp({ quality: 90 }).toFile(p); break;
    case 'avif': await pipe.avif({ quality: 60 }).toFile(p); break;
  }
  return p;
}

/** Build a minimal valid animated (2-frame) WebP via RIFF container assembly.
 *  sharp cannot emit animated WebP from an image array, so we encode each frame
 *  as a lossless VP8L single-frame WebP, then wrap them in VP8X+ANIM+ANMF. */
async function buildAnimatedWebp(): Promise<Buffer> {
  const u24 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
  const chunk = (fourcc: string, data: Buffer) => {
    const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
    return Buffer.concat([Buffer.from(fourcc, 'ascii'),
      Buffer.from([data.length & 255, (data.length >> 8) & 255, (data.length >> 16) & 255, (data.length >>> 24) & 255]),
      data, pad]);
  };
  async function frameBitstream(r: number, g: number, b: number): Promise<Buffer> {
    const webp = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r, g, b, alpha: 255 } } })
      .webp({ lossless: true }).toBuffer();
    let off = 12;
    while (off + 8 <= webp.length) {
      const id = webp.toString('ascii', off, off + 4);
      const sz = webp.readUInt32LE(off + 4);
      if (id === 'VP8L' || id === 'VP8 ') return webp.slice(off, off + 8 + sz);
      off += 8 + sz + (sz % 2);
    }
    throw new Error('no VP8L frame in single-frame webp');
  }
  const W = 4, H = 4;
  const f1 = await frameBitstream(255, 0, 0);
  const f2 = await frameBitstream(0, 255, 0);
  const vp8x = chunk('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(W - 1), u24(H - 1)]));
  const anim = chunk('ANIM', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0])]));
  const anmf = (frame: Buffer, dur: number) => chunk('ANMF', Buffer.concat([
    u24(0), u24(0), u24(W - 1), u24(H - 1), u24(dur), Buffer.from([0]), frame]));
  const body = Buffer.concat([vp8x, anim, anmf(f1, 100), anmf(f2, 100)]);
  return Buffer.concat([Buffer.from('RIFF'),
    Buffer.from([(body.length + 4) & 255, ((body.length + 4) >> 8) & 255, ((body.length + 4) >> 16) & 255, ((body.length + 4) >>> 24) & 255]),
    Buffer.from('WEBP'), body]);
}

async function convert(sourcePath: string, target: string, profile = 'balanced', extra: any = {}) {
  return converter.convert({
    sourcePath, targetFormat: target as any, profile,
    output: { directory: outDir, conflict: 'version' },
    ...extra,
  });
}

// ─── 12-pair conversion matrix (balanced profile) ──────────────────────────
describe('12-pair conversion matrix (balanced)', () => {
  const sources: Record<ImageKind, string> = {} as any;

  beforeAll(async () => {
    for (const k of IMAGE_KINDS) sources[k] = await genImage(k);
  });

  for (const from of IMAGE_KINDS) {
    for (const to of IMAGE_KINDS) {
      if (from === to) continue;
      it(`${from} -> ${to}`, async () => {
        const beforeHash = await sha256File(sources[from]!);
        const r = await convert(sources[from]!, to, 'balanced');
        expect(r.status).toBe('succeeded');
        if (r.status !== 'succeeded') return;
        // Source unchanged
        expect(await sha256File(sources[from]!)).toBe(beforeHash);
        // Output exists, non-empty
        const stat = await fsp.stat(r.output.path);
        expect(stat.size).toBeGreaterThan(0);
        // Output re-decodable with correct format (AVIF reported as 'heif' by libvips)
        const meta = await sharp(r.output.path).metadata();
        const expectedFmt = to === 'avif' ? 'heif' : (to === 'jpeg' ? 'jpeg' : to);
        expect(meta.format).toBe(expectedFmt);
        // Dimensions preserved (no orientation swap in these fixtures)
        expect(meta.width).toBe(40);
        expect(meta.height).toBe(30);
        // Validator passed
        expect(r.validation.passed).toBe(true);
        expect(r.validation.validator).toBe('image-sharp-v1');
        // Engine is sharp
        expect(r.engine.actual).toBe('sharp');
      });
    }
  }
});

// ─── Profiles ───────────────────────────────────────────────────────────────
describe('profiles', () => {
  let srcPng: string, srcJpeg: string;

  beforeAll(async () => {
    srcPng = await genImage('png');
    srcJpeg = await genImage('jpeg');
  });

  it('balanced: png-to-jpeg q80 4:2:0', async () => {
    const r = await convert(srcPng, 'jpeg', 'balanced');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const meta = await sharp(r.output.path).metadata();
    expect(meta.format).toBe('jpeg');
    // lossy_reencode warning present
    expect(r.warnings.some((w) => w.code === 'FC_LOSSY_REENCODE')).toBe(true);
  });

  it('high_quality: png-to-jpeg q92 4:4:4', async () => {
    const r = await convert(srcPng, 'jpeg', 'high_quality');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const meta = await sharp(r.output.path).metadata();
    expect(meta.format).toBe('jpeg');
    // high_quality should generally produce larger file than balanced at same source
    const balanced = await convert(srcPng, 'jpeg', 'balanced');
    if (balanced.status === 'succeeded') {
      const hqSize = (await fsp.stat(r.output.path)).size;
      const balSize = (await fsp.stat(balanced.output.path)).size;
      expect(hqSize).toBeGreaterThanOrEqual(balSize);
    }
  });

  it('lossless: png-to-webp lossless', async () => {
    const r = await convert(srcPng, 'webp', 'lossless');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const meta = await sharp(r.output.path).metadata();
    expect(meta.format).toBe('webp');
    // No lossy_reencode warning for lossless
    expect(r.warnings.some((w) => w.code === 'FC_LOSSY_REENCODE')).toBe(false);
  });

  it('lossless: png-to-avif lossless', async () => {
    const r = await convert(srcPng, 'avif', 'lossless');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const meta = await sharp(r.output.path).metadata();
    expect(meta.format).toBe('heif'); // AVIF reported as heif by libvips
  });

  it('lossless + jpeg target -> unsupported_feature', async () => {
    const r = await convert(srcPng, 'jpeg', 'lossless');
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_UNSUPPORTED_FEATURE');
  });

  it('standard profile aliases to balanced', async () => {
    const r = await convert(srcPng, 'jpeg', 'standard');
    expect(r.status).toBe('succeeded');
  });
});

// ─── Alpha: JPEG flatten (alpha is intentionally removed) ───────────────────
describe('alpha jpeg flatten', () => {
  let srcPngAlpha: string;
  beforeAll(async () => { srcPngAlpha = await genImage('png', { alpha: true }); });

  it('alpha png -> jpeg: flattened, alpha_flattened warning, no alpha in output', async () => {
    const r = await convert(srcPngAlpha, 'jpeg', 'balanced');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.warnings.some((w) => w.code === 'FC_ALPHA_FLATTENED')).toBe(true);
    const meta = await sharp(r.output.path).metadata();
    expect(meta.hasAlpha).toBeFalsy();
    expect(meta.channels).toBe(3);
    expect(r.validation.checks.find((c) => c.name === 'alpha-absent')?.passed).toBe(true);
  });

  it('alpha png -> jpeg with custom flatten background', async () => {
    const r = await convert(srcPngAlpha, 'jpeg', 'balanced', {
      imageOptions: { flattenBackground: '#00ff00' },
    });
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.warnings.some((w) => w.code === 'FC_ALPHA_FLATTENED')).toBe(true);
  });
});

// ─── Precise alpha-plane preservation ───────────────────────────────────────
// Raw-RGBA fixtures (NOT sharp.create, which does not bake semi-transparent
// background alpha). Covers uniform 0/1/128/250/254/255, gradient, mixed, across
// PNG, WebP (3 profiles), AVIF (3 profiles).
type AlphaMode = 0 | 1 | 128 | 250 | 254 | 255 | 'gradient' | 'mixed';
const ALPHA_MODES: AlphaMode[] = [0, 1, 128, 250, 254, 255, 'gradient', 'mixed'];
const AW = 16, AH = 16;

function buildAlphaRaw(mode: AlphaMode): Buffer {
  const raw = Buffer.alloc(AW * AH * 4);
  for (let i = 0; i < AW * AH; i++) {
    raw[i * 4] = 200; raw[i * 4 + 1] = 60; raw[i * 4 + 2] = 120;
    let a: number;
    if (mode === 'gradient') a = Math.round((i % AW) / (AW - 1) * 255);
    else if (mode === 'mixed') a = [0, 64, 128, 255][i % 4]!;
    else a = mode;
    raw[i * 4 + 3] = a;
  }
  return raw;
}

async function genAlphaSource(mode: AlphaMode, kind: ImageKind): Promise<string> {
  const p = path.join(tmpRoot, `alpha-${String(mode)}.${EXT[kind]}`);
  let pipe = sharp(buildAlphaRaw(mode), { raw: { width: AW, height: AH, channels: 4 } });
  if (kind === 'png') await pipe.png().toFile(p);
  else if (kind === 'webp') await pipe.webp({ lossless: true, alphaQuality: 100 }).toFile(p);
  else await pipe.avif({ lossless: true }).toFile(p);
  return p;
}

/** Independently decode an output and return its alpha plane (auto-oriented). */
async function outputAlphaPlane(p: string): Promise<Uint8Array> {
  const { data } = await sharp(p).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(AW * AH);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) a[j] = data[i + 3]!;
  return a;
}

describe('alpha fixture self-check (raw RGBA, not create())', () => {
  for (const mode of [0, 1, 128, 250, 254, 255] as const) {
    it(`uniform alpha=${mode} fixture decodes back to exactly ${mode}`, async () => {
      const p = await genAlphaSource(mode, 'png');
      const plane = await outputAlphaPlane(p);
      expect(plane.length).toBe(AW * AH);
      for (const v of plane) expect(v).toBe(mode);
    });
  }
});

describe('alpha-plane preservation matrix', () => {
  // (source kind, target, profile) — PNG target needs a non-PNG (webp) source.
  const CASES: Array<{ srcKind: ImageKind; to: ImageKind; profile: 'balanced' | 'high_quality' | 'lossless' }> = [
    { srcKind: 'png', to: 'webp', profile: 'balanced' },
    { srcKind: 'png', to: 'webp', profile: 'high_quality' },
    { srcKind: 'png', to: 'webp', profile: 'lossless' },
    { srcKind: 'png', to: 'avif', profile: 'balanced' },
    { srcKind: 'png', to: 'avif', profile: 'high_quality' },
    { srcKind: 'png', to: 'avif', profile: 'lossless' },
    { srcKind: 'webp', to: 'png', profile: 'balanced' },
  ];

  for (const mode of ALPHA_MODES) {
    for (const c of CASES) {
      it(`mode=${String(mode).padEnd(8)} ${c.srcKind}->${c.to} [${c.profile}] preserves alpha plane`, async () => {
        const src = await genAlphaSource(mode, c.srcKind);
        const srcMeta = await sharp(src).metadata();
        const r = await convert(src, c.to, c.profile);
        expect(r.status, r.status === 'failed' ? JSON.stringify(r.error) : '').toBe('succeeded');
        if (r.status !== 'succeeded') return;
        // The product validator runs its precise plane check whenever the source
        // actually carries an alpha channel (an all-opaque source may have had its
        // channel dropped by the source encoder, in which case no check is needed).
        const check = r.validation.checks.find((x) => x.name === 'alpha-plane-preserved');
        if (srcMeta.hasAlpha === true) {
          expect(check?.passed, check?.detail ?? 'missing alpha-plane-preserved check').toBe(true);
        }

        // Independent verification: a legal uniform semi-transparent input must
        // NOT become opaque, and exact-gate formats must reproduce values exactly.
        const expected = buildAlphaRaw(mode);
        const out = await outputAlphaPlane(r.output.path);
        const exactGate = c.to === 'png' || c.to === 'webp' || (c.to === 'avif' && c.profile === 'lossless');
        let maxErr = 0;
        for (let i = 3, j = 0; j < out.length; i += 4, j++) {
          const d = Math.abs(expected[i]! - out[j]!);
          if (d > maxErr) maxErr = d;
        }
        if (mode !== 255) {
          // transparency must survive: at least one non-opaque output pixel
          expect(Math.min(...out), `mode=${mode} became opaque`).toBeLessThan(255);
        }
        if (exactGate) expect(maxErr, `exact gate violated maxErr=${maxErr}`).toBe(0);
        else expect(maxErr).toBeLessThanOrEqual(40); // AVIF lossy corpus bound
      });
    }
  }
});

// ─── Metadata policy ────────────────────────────────────────────────────────
describe('metadata policy', () => {
  let srcJpegWithExif: string;

  beforeAll(async () => {
    // Create JPEG with EXIF metadata (Artist + Copyright).
    const buf = await sharp({ create: { width: 20, height: 15, channels: 3, background: { r: 50, g: 100, b: 150, alpha: 1 } as any } })
      .jpeg()
      .toBuffer();
    const withMeta = await sharp(buf)
      .withMetadata({ exif: { IFD0: { Artist: 'TestArtist', Copyright: '(c) 2026 Test' } } as any })
      .jpeg()
      .toBuffer();
    srcJpegWithExif = path.join(tmpRoot, 'meta-src.jpg');
    await fsp.writeFile(srcJpegWithExif, withMeta);
  });

  it('strip (default): output has no EXIF', async () => {
    const r = await convert(srcJpegWithExif, 'png', 'balanced');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const meta = await sharp(r.output.path).metadata();
    expect(meta.exif).toBeUndefined();
    expect(r.validation.checks.find((c) => c.name === 'metadata-stripped')?.passed).toBe(true);
  });

  it('keep-copyright metadata policy is rejected in v1.1 (strip-only)', async () => {
    const r = await convert(srcJpegWithExif, 'png', 'balanced', {
      imageOptions: { metadata: 'keep-copyright' },
    });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') throw new Error(JSON.stringify(r));
    expect(r.error.code).toBe('FC_UNSUPPORTED_FEATURE');
    // The supported 'strip' policy (tested above) removes GPS + copyright.
  });
});

// ─── CMYK ───────────────────────────────────────────────────────────────────
describe('CMYK JPEG', () => {
  let srcCmyk: string;

  beforeAll(async () => {
    const buf = await sharp({ create: { width: 20, height: 15, channels: 3, background: { r: 100, g: 150, b: 200, alpha: 1 } as any } })
      .toColorspace('cmyk')
      .jpeg()
      .toBuffer();
    srcCmyk = path.join(tmpRoot, 'cmyk-src.jpg');
    await fsp.writeFile(srcCmyk, buf);
  });

  it('CMYK jpeg -> png: converted to sRGB, cmyk_no_icc warning if no ICC', async () => {
    const r = await convert(srcCmyk, 'png', 'balanced');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const meta = await sharp(r.output.path).metadata();
    expect(meta.space).toBe('srgb');
    // CMYK without ICC should warn
    const srcMeta = await sharp(srcCmyk).metadata();
    if (!srcMeta.icc) {
      expect(r.warnings.some((w) => w.code === 'FC_CMYK_NO_ICC')).toBe(true);
    }
  });
});

// ─── Animated / multi-frame rejection (real 2-frame WebP, no skip) ──────────
describe('animated image rejection', () => {
  it('real 2-frame animated webp: detected pages>1, rejected unsupported_feature (never first frame)', async () => {
    const animBuf = await buildAnimatedWebp();
    // Sanity: sharp itself confirms this is a genuine multi-frame image.
    const animMeta = await sharp(animBuf).metadata();
    expect(animMeta.format).toBe('webp');
    expect((animMeta.pages ?? 1)).toBeGreaterThan(1);
    const p = path.join(tmpRoot, 'real-anim.webp');
    await fsp.writeFile(p, animBuf);
    // Conversion must refuse, not silently take the first frame.
    const r = await convert(p, 'png', 'balanced');
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_UNSUPPORTED_FEATURE');
  });
});

// ─── Size limits ────────────────────────────────────────────────────────────
describe('size limits', () => {
  it('image with edge >30000 -> source_too_large', async () => {
    // Create a wide image (30001x1) — use SVG-like create, but sharp create max is limited.
    // Instead, craft a PNG header that claims huge dimensions but has minimal data.
    // Actually sharp's create has limits. We'll test the edge limit by creating a valid
    // large-dimension small-data image via raw PNG encoding.
    const w = 30001, h = 1;
    // Minimal PNG: IHDR + IDAT (all zero raw) + IEND
    const crc32 = (buf: Buffer) => {
      let c = ~0;
      for (let i = 0; i < buf.length; i++) { c ^= buf[i]!; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
      return ~c >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      const typeB = Buffer.from(type, 'ascii');
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
      return Buffer.concat([len, typeB, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
    // IDAT: zlib compress of (h rows of (1 filter byte + w*4 pixel bytes))
    const zlib = await import('node:zlib');
    const raw = Buffer.alloc(h * (1 + w * 4)); // all zeros
    const idatData = zlib.deflateSync(raw);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idatData),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const p = path.join(tmpRoot, 'huge.png');
    await fsp.writeFile(p, png);
    const r = await convert(p, 'jpeg', 'balanced');
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_INPUT_TOO_LARGE');
  });
});

// ─── Corrupt / malformed ────────────────────────────────────────────────────
describe('corrupt images', () => {
  it('truncated PNG -> malformed_file', async () => {
    const p = path.join(tmpRoot, 'trunc.png');
    await fsp.writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]));
    const r = await convert(p, 'jpeg', 'balanced');
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_SOURCE_CORRUPT');
  });

  it('fake extension: real PNG renamed .jpg -> detected as png, extension_mismatch warning', async () => {
    const realPng = await genImage('png');
    const fakePath = path.join(tmpRoot, 'fake.jpg');
    await fsp.copyFile(realPng, fakePath);
    const det = await converter.detectFile(fakePath);
    expect((det as any).kind).toBe('png');
    expect((det as any).warnings?.some((w: any) => w.code === 'FC_EXTENSION_MISMATCH')).toBe(true);
    // Conversion still works using real type
    const r = await convert(fakePath, 'webp', 'balanced');
    expect(r.status).toBe('succeeded');
  });
});

// ─── Output validator deep checks ───────────────────────────────────────────
describe('output validator', () => {
  it('validator name is image-sharp-v1 for image conversions', async () => {
    const src = await genImage('png');
    const r = await convert(src, 'jpeg', 'balanced');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.validation.validator).toBe('image-sharp-v1');
    expect(r.validation.checks.length).toBeGreaterThanOrEqual(4);
    expect(r.validation.checks.find((c) => c.name === 're-decodable')?.passed).toBe(true);
    expect(r.validation.checks.find((c) => c.name === 'format-match')?.passed).toBe(true);
    expect(r.validation.checks.find((c) => c.name === 'dimensions-match')?.passed).toBe(true);
  });
});

// ─── Provenance compact size ────────────────────────────────────────────────
describe('provenance', () => {
  it('compact provenance is within 16KiB', async () => {
    const src = await genImage('png');
    const r = await convert(src, 'webp', 'balanced');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const provJson = JSON.stringify(r.provenance);
    expect(Buffer.byteLength(provJson, 'utf8')).toBeLessThanOrEqual(16 * 1024);
  });
});
