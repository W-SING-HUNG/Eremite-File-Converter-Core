import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeHostHarness, type HostHarness } from './helpers/host-harness.js';

const BAD: Array<{ name: string; body: string }> = [
  { name: 'script', body: '# t\n\n<script src="http://x/y.js"></script>\n' },
  { name: 'link', body: '# t\n\n<link rel="stylesheet" href="http://x/y.css">\n' },
  { name: 'style', body: '# t\n\n<style>body{}</style>\n' },
  { name: 'base', body: '# t\n\n<base href="http://x/">\n' },
  { name: 'md-local-img', body: '# t\n\n![a](./pic.png)\n' },
  { name: 'md-remote-img', body: '# t\n\n![a](http://127.0.0.1:9/p.png)\n' },
];

describe('Pandoc Markdown raw-HTML / resource preflight', () => {
  let h: HostHarness;
  beforeAll(async () => { h = await makeHostHarness(); });
  afterAll(async () => { await h.cleanup(); });

  for (const c of BAD) {
    it(`rejects ${c.name} before spawning Pandoc`, async () => {
      const src = await h.writeSource(`source-${c.name}`, Buffer.from(c.body, 'utf8'));
      const req = await h.buildRequest({ sourcePath: src, conversionId: 'markdown-to-html', outputName: `${c.name}.html` });
      const r = await h.run(req);
      expect(r.status).toBe('failed');
      if (r.status !== 'failed') throw new Error('x');
      expect(r.errors[0]?.code).toBe('FC_RESOURCE_BUNDLE_REQUIRED');
    });
  }

  it('allows an ordinary hyperlink and keeps it (no fetch needed)', async () => {
    const src = await h.writeSource('source-ok', Buffer.from('# t\n\n[open](https://example.invalid/page)\n', 'utf8'));
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'markdown-to-html', outputName: 'ok.html' });
    const r = await h.run(req);
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r));
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(req.workspace.outputPath, 'utf8');
    expect(html).toContain('example.invalid/page');
    expect(html).toContain('<a ');
  });
});
