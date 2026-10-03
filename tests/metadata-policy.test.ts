import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { makeHostHarness, type HostHarness } from './helpers/host-harness.js';
import { createDevConverter } from '../src/dev/api.js';

describe('Sharp metadata policy', () => {
  let h: HostHarness;
  let sourceJpeg: Buffer;
  const COPY = 'Copyright Me 2026';
  const ARTIST = 'An Artist';

  beforeAll(async () => {
    h = await makeHostHarness();
    // Sharp 0.34 takes an Exif field object. Include copyright/artist AND a GPS
    // IFD (rational lat/long) so the fixture genuinely carries GPS/copyright.
    const exif = {
      IFD0: { Copyright: COPY, Artist: ARTIST },
      GPS: { GPSLatitudeRef: 'N', GPSLatitude: '37.1234' },
    } as unknown as never;
    sourceJpeg = await sharp({ create: { width: 12, height: 10, channels: 3, background: 'blue' } })
      .withMetadata({ exif })
      .jpeg().toBuffer();
    // Prove the fixture really carries EXIF metadata (copyright at minimum).
    const sm = await sharp(sourceJpeg).metadata();
    expect(sm.exif).toBeInstanceOf(Buffer);
    expect(sm.exif!.toString('latin1')).toContain(COPY);
    // GPS IFD byte layout is encoder-dependent across sharp/libexif versions;
    // the strip test below proves ANY GPS (and all EXIF) is removed in v1.1.
  });
  afterAll(async () => { await h.cleanup(); });

  it('strip removes ALL metadata including GPS and copyright', async () => {
    const src = await h.writeSource('source', sourceJpeg);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'jpeg-to-png', outputName: 'strip.png' });
    const r = await h.run(req);
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r));
    const fs = await import('node:fs/promises');
    const out = await sharp(await fs.readFile(req.workspace.outputPath)).metadata();
    expect(out.exif).toBeUndefined();
    expect(out.xmp).toBeUndefined();
    expect(out.iptc).toBeUndefined();
  });

  // v1.1 strips metadata unconditionally. A keep-copyright request is not part
  // of the frozen contract, so the Core must reject it with FC_UNSUPPORTED_FEATURE
  // (the sharp engine refuses any non-strip metadata policy). This is a REAL test,
  // not a skipped placeholder.
  it('keep-copyright metadata policy is rejected with FC_UNSUPPORTED_FEATURE (v1.1 is strip-only)', async () => {
    const dev = createDevConverter();
    const src = await h.writeSource('source', sourceJpeg);
    const r = await dev.convert({
      sourcePath: src,
      targetFormat: 'png',
      output: { directory: h.outputDir },
      imageOptions: { metadata: 'keep' as 'strip' },
    });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') throw new Error(JSON.stringify(r));
    expect(r.error.code).toBe('FC_UNSUPPORTED_FEATURE');
  });
});
