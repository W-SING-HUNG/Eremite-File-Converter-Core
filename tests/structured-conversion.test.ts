/**
 * Phase 3 — Pandoc structured-document tests.
 * Real Pandoc (no mocks): MD→HTML, HTML→MD, MD→DOCX. Covers Chinese/Unicode/
 * Emoji, full structure, semantic preservation, standalone resource preflight,
 * zero-fetch hyperlinks, DOCX OOXML validity, source immutability, no-clobber.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDevConverter } from '../src/dev/api.js';
import { findEmbeddedResources, PandocEngine } from '../src/index.js';
import { sha256File } from '../src/validation/validator.js';
import { readZipEntries, extractZipEntry } from '../src/detection/zip-container.js';

let tmpRoot: string;
let outDir: string;
let converter: ReturnType<typeof createDevConverter>;
const engine = new PandocEngine();

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-struct-test-'));
  outDir = path.join(tmpRoot, 'out');
  await fsp.mkdir(outDir, { recursive: true });
  converter = createDevConverter();
  // Real Pandoc with sandbox is mandatory for this suite — fail, never skip.
  expect(await engine.available(), 'Pandoc 3.1+ with --sandbox must be installed').toBe(true);
});

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

async function writeFile(name: string, content: string): Promise<string> {
  const p = path.join(tmpRoot, name);
  await fsp.writeFile(p, content, 'utf8');
  return p;
}

async function convert(sourcePath: string, target: string, extra: any = {}) {
  return converter.convert({
    sourcePath, targetFormat: target as any,
    output: { directory: outDir, conflict: 'version' },
    ...extra,
  });
}

const RICH_MD = [
  '# 一级标题 H1',
  '## Heading Two',
  '###### H6 标题',
  '',
  '一段中文段落，包含 **加粗**、*斜体*、`内联代码` 与 Emoji 😀🚀。',
  'English sentence with special chars < > & " \' and a long line. ',
  '',
  '> 这是一段引用 blockquote。',
  '',
  '- 项目一',
  '  - 嵌套项目 1.1',
  '  - 嵌套项目 1.2',
  '- 项目二',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '```js',
  "const fenced = () => 'code block';",
  '```',
  '',
  '| 姓名 | 分数 |',
  '|---|---:|',
  '| 张三 | 95 |',
  '| Alice | 88 |',
  '',
  '普通链接 [OpenAI](https://example.invalid/) 与 <sup>上标</sup>。',
].join('\n');

const RICH_HTML = [
  '<!doctype html><html><body>',
  '<h1>主标题 Title 中文</h1>',
  '<h2>Sub 小标题</h2>',
  '<p>段落 with <strong>bold</strong>, <em>italic</em>, <code>code</code> and 😀.</p>',
  '<blockquote><p>引用 quote</p></blockquote>',
  '<ul><li>无序一<ul><li>嵌套 a</li></ul></li><li>无序二</li></ul>',
  '<ol><li>有序一</li><li>有序二</li></ol>',
  '<table><thead><tr><th>A</th><th>B</th></tr></thead>',
  '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
  '<pre><code>const x = 1;</code></pre>',
  '<p>链接 <a href="https://example.invalid/page">anchor 文本</a></p>',
  '</body></html>',
].join('\n');

// ─── Engine / dependency ────────────────────────────────────────────────────
describe('pandoc engine dependency', () => {
  it('reports a real version and sandboxed profile', async () => {
    const v = await engine.version();
    expect(v).toMatch(/^\d+\.\d+/);
    const caps = await converter.getCapabilities();
    const info = caps.engines.find((e) => e.id === 'pandoc')!;
    expect(info.found).toBe(true);
    expect(info.provides).toEqual(
      expect.arrayContaining(['markdown-to-html', 'html-to-markdown', 'markdown-to-docx']),
    );
  });
});

// ─── Standalone resource preflight (unit, no spawn) ─────────────────────────
describe('standalone resource preflight', () => {
  it('plain markdown link and text have NO resource hits', () => {
    expect(findEmbeddedResources('markdown', 'see [site](https://x.com/) and text')).toHaveLength(0);
  });
  it('plain HTML anchor has NO resource hits', () => {
    expect(findEmbeddedResources('html', "<p><a href='https://x.com/'>go</a></p>")).toHaveLength(0);
  });
  it('resource example inside fenced code is NOT flagged', () => {
    const md = '```html\n<img src="x.png">\n```';
    expect(findEmbeddedResources('markdown', md)).toHaveLength(0);
  });

  const mdReject: Array<[string, string]> = [
    ['local image', '![alt](./images/a.png)'],
    ['remote image', '![x](https://cdn.example/x.png)'],
    ['raw img', '<img src="a.png">'],
    ['raw iframe', '<iframe src="https://x"></iframe>'],
    ['raw video', '<video controls><source src="a.mp4"></video>'],
    ['ssi include', '<!--#include virtual="h.html" -->'],
    ['reference image', '![cat][pic]\n\n[pic]: https://x/cat.png'],
  ];
  for (const [name, body] of mdReject) {
    it(`MD rejects ${name}`, () => {
      expect(findEmbeddedResources('markdown', body).length).toBeGreaterThan(0);
    });
  }

  const htmlReject: Array<[string, string]> = [
    ['img', "<img src='a.png'>"],
    ['script src', "<script src='app.js'></script>"],
    ['stylesheet link', "<link rel='stylesheet' href='s.css'>"],
    ['video', "<video src='v.mp4'></video>"],
    ['audio', "<audio src='a.mp3'></audio>"],
    ['iframe', "<iframe src='x'></iframe>"],
    ['object', "<object data='x.swf'></object>"],
    ['embed', "<embed src='x.swf'>"],
    ['css url()', "<style>body{background:url(bg.png)}</style>"],
    ['base href', "<base href='https://x/'>"],
  ];
  for (const [name, body] of htmlReject) {
    it(`HTML rejects ${name}`, () => {
      expect(findEmbeddedResources('html', body).length).toBeGreaterThan(0);
    });
  }
});

// ─── MD → HTML ──────────────────────────────────────────────────────────────
describe('markdown -> html', () => {
  let out = '';
  let srcPath = '';
  let beforeHash = '';

  beforeAll(async () => {
    srcPath = await writeFile('rich.md', RICH_MD);
    beforeHash = await sha256File(srcPath);
    const r = await convert(srcPath, 'html');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r.error));
    out = await fsp.readFile(r.output.path, 'utf8');
  });

  it('succeeds via pandoc with sandbox', () => {
    expect(out).toContain('<h1');
    expect(out).toContain('一级标题');
  });
  it('preserves headings h1-h6, emphasis, inline code', () => {
    expect(out).toMatch(/<h1[\s>]/);
    expect(out).toMatch(/<h6[\s>]/);
    expect(out).toContain('<strong>加粗</strong>');
    expect(out).toContain('<code>内联代码</code>');
  });
  it('preserves nested + ordered lists and blockquote', () => {
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>嵌套项目 1.1</li>');
    expect(out).toMatch(/<ol\b/); // pandoc emits <ol type="1">
    expect(out).toContain('<blockquote>');
  });
  it('preserves fenced code block (highlighting may insert spans)', () => {
    expect(out).toMatch(/<pre\b/);
    // Strip syntax-highlight tags + decode entities: source survives.
    const text = out.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    expect(text).toContain('const fenced');
    expect(text).toContain('code block');
  });
  it('preserves GFM table', () => {
    expect(out).toContain('<table>');
    expect(out).toContain('<th>姓名</th>');
    expect(out).toContain('<td>张三</td>');
  });
  it('keeps plain hyperlink and emoji, no resource leak', () => {
    expect(out).toContain('href="https://example.invalid/"');
    expect(out).toContain('😀');
    expect(findEmbeddedResources('html', out)).toHaveLength(0);
  });
  it('passes raw inline HTML through (gfm-raw_html)', () => {
    expect(out).toContain('<sup>上标</sup>');
  });
  it('source file SHA-256 unchanged', async () => {
    expect(await sha256File(srcPath!)).toBe(beforeHash);
  });
});

// ─── HTML → Markdown ────────────────────────────────────────────────────────
describe('html -> markdown', () => {
  let out = '';

  beforeAll(async () => {
    const src = await writeFile('rich.html', RICH_HTML);
    const r = await convert(src, 'markdown');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r.error));
    out = await fsp.readFile(r.output.path, 'utf8');
  });

  it('keeps headings (not flattened to plain text)', () => {
    expect(out).toMatch(/^#\s+主标题/m);
    expect(out).toMatch(/^##\s/m);
  });
  it('keeps emphasis and inline code', () => {
    expect(out).toContain('**bold**');
    expect(out).toMatch(/`code`/);
  });
  it('keeps nested unordered and ordered lists', () => {
    expect(out).toMatch(/^[-*]\s+无序一/m);
    expect(out).toMatch(/嵌套 a/);
    expect(out).toMatch(/1\.\s+有序一/);
  });
  it('keeps blockquote and fenced code', () => {
    expect(out).toMatch(/^>\s+引用 quote/m);
    expect(out).toContain('const x = 1;');
  });
  it('keeps GFM table (whitespace-tolerant)', () => {
    expect(out).toMatch(/\|\s*A\s*\|\s*B\s*\|/);
    expect(out).toMatch(/^\|[\s:|-]+\|\s*$/m);
    expect(out).toMatch(/\|\s*1\s*\|\s*2\s*\|/);
  });
  it('keeps anchor link and Chinese/emoji', () => {
    expect(out).toContain('[anchor 文本](https://example.invalid/page)');
    expect(out).toContain('中文');
    expect(out).toContain('😀');
  });
});

// ─── MD → DOCX ──────────────────────────────────────────────────────────────
describe('markdown -> docx', () => {
  let docxPath = '';
  let documentXml = '';

  beforeAll(async () => {
    const src = await writeFile('doc.md', RICH_MD);
    const r = await convert(src, 'docx');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r.error));
    docxPath = r.output.path;
    const buf = await fsp.readFile(docxPath);
    const entries = readZipEntries(buf);
    const doc = entries.find((e) => /word\/document\.xml$/.test(e.name))!;
    documentXml = extractZipEntry(buf, doc).toString('utf8');
  });

  it('produces a valid OOXML package with validator checks', async () => {
    const r = await convert(await writeFile('small.md', '# Hi\n\nbody'), 'docx');
    expect(r.status).toBe('succeeded');
    if (r.status === 'succeeded') {
      const names = r.validation.checks.map((c) => c.name);
      for (const n of ['zip-openable', 'content-types', 'document-part', 'document-xml-well-formed', 'no-media-bundle']) {
        expect(names).toContain(n);
      }
      expect(r.validation.passed).toBe(true);
    }
  });
  it('document.xml retains heading text', () => {
    expect(documentXml).toContain('一级标题');
    expect(documentXml).toContain('Heading Two');
  });
  it('retains table (w:tbl), list and Chinese', () => {
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('张三');
    expect(documentXml).toContain('项目一');
  });
  it('retains hyperlink and no media bundle', () => {
    expect(documentXml).toContain('OpenAI');
    expect(documentXml).not.toContain('<w:drawing');
  });
});

// ─── Resource rejection through the full pipeline ──────────────────────────
describe('pipeline resource rejection', () => {
  const cases: Array<[string, string, string, string]> = [
    ['md-local-img', '.md', '![a](./a.png)', 'html'],
    ['md-remote-img', '.md', '![a](https://x/a.png)', 'html'],
    ['md-iframe', '.md', '<iframe src="https://x"></iframe>', 'html'],
    ['html-img', '.html', "<p>x</p><img src='a.png'>", 'markdown'],
    ['html-script', '.html', "<script src='a.js'></script>", 'markdown'],
    ['html-link-css', '.html', "<link rel='stylesheet' href='a.css'>", 'markdown'],
    ['html-video', '.html', "<video src='a.mp4'></video>", 'markdown'],
    ['html-iframe', '.html', "<iframe src='x'></iframe>", 'markdown'],
    ['html-url', '.html', "<style>body{url(a.png)}</style>", 'markdown'],
    ['html-base', '.html', "<base href='https://x/'>", 'markdown'],
  ];
  for (const [name, ext, body, target] of cases) {
    it(`${name} -> resource_bundle_required`, async () => {
      const src = await writeFile(`rej-${name}${ext}`, body);
      const r = await convert(src, target);
      expect(r.status).toBe('failed');
      if (r.status === 'failed') expect(r.error.code).toBe('FC_RESOURCE_BUNDLE_REQUIRED');
    });
  }
});

// ─── Zero-fetch hyperlink ───────────────────────────────────────────────────
describe('hyperlink zero-fetch', () => {
  it('plain link converts, is kept, and raises no fetch warning under sandbox', async () => {
    const src = await writeFile('link.md', '# T\n\nRead [the docs](https://example.invalid/).\n');
    const r = await convert(src, 'html');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const html = await fsp.readFile(r.output.path, 'utf8');
    expect(html).toContain('href="https://example.invalid/"');
    expect(r.warnings.some((w) => /FETCH|RESOURCE/i.test(w.code))).toBe(false);
    expect(r.engine.actualVersion).toMatch(/^pandoc-/);
  });
});

// ─── no-clobber does not regress ────────────────────────────────────────────
describe('structured publish no-clobber', () => {
  it('reject mode: second same-name conversion -> output_conflict', async () => {
    const d = path.join(tmpRoot, 'nc');
    await fsp.mkdir(d, { recursive: true });
    const src = await writeFile('nc.md', '# Same\n\ntext');
    const a = await converter.convert({ sourcePath: src, targetFormat: 'html', output: { directory: d, conflict: 'reject' } });
    expect(a.status).toBe('succeeded');
    if (a.status !== 'succeeded') return;
    const firstHash = await sha256File(a.output.path);
    const b = await converter.convert({ sourcePath: src, targetFormat: 'html', output: { directory: d, conflict: 'reject' } });
    expect(b.status).toBe('failed');
    if (b.status === 'failed') expect(b.error.code).toBe('FC_OUTPUT_CONFLICT');
    expect(await sha256File(a.output.path)).toBe(firstHash);
  });
});
