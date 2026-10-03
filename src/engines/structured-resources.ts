/**
 * Standalone / single-file resource preflight (structured resource boundary).
 *
 * v1 structured conversions are semantic-standalone: ordinary text, structure,
 * tables and plain hyperlinks convert, but ANY embedded/local/remote resource
 * dependency is rejected BEFORE pandoc runs — no download, no relative-path
 * guessing, no silent dropping, no post-hoc warning.
 *
 * Plain hyperlinks (`[t](u)` in Markdown, `<a href>` in HTML) always pass and
 * are never fetched. Fenced/inline code is excluded from the Markdown scan so a
 * document may legitimately show an `<img>` as a code example.
 *
 * Markdown is read with gfm-raw_html (raw HTML passes through), so the Markdown
 * scan also rejects the execution/resource raw tags <script>/<link>/<style>/<base>
 * in addition to media/embed tags.
 */
import { ToolError } from '../core/errors.js';

export type StructuredKind = 'markdown' | 'html';

export interface ResourceHit {
  kind: string;
  snippet: string;
}

/** Raw-HTML execution/resource tags blocked in BOTH html and gfm-raw_html markdown. */
const UNSAFE_TAG = '(?:img|picture|video|audio|iframe|object|embed|source|track|script|link|style|base)';

function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/** Remove fenced/indented code regions so example markup in code is not flagged. */
function stripMarkdownCode(src: string): string {
  return src
    .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^\s*\1[ \t]*$/gm, '') // fenced blocks
    .replace(/`[^`\n]*`/g, '');                                  // inline code
}

function stripHtmlCode(src: string): string {
  return src
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[\s\S]*?<\/code>/gi, '');
}

function markdownHits(text: string): ResourceHit[] {
  const hits: ResourceHit[] = [];
  const body = stripMarkdownCode(text);
  const add = (kind: string, raw: string | undefined) => { if (raw !== undefined) hits.push({ kind, snippet: clip(raw) }); };

  // Inline image:  ![alt](url "title")
  const reInlineImg = /!\[[^\]]*\]\(\s*<?([^)>]*?)>?\s*(?:"[^"]*"|'[^']*')?\)/g;
  let m: RegExpExecArray | null;
  while ((m = reInlineImg.exec(body))) add('markdown-image', m[0]);

  // Reference / shortcut image:  ![alt][id]  or  ![alt][]
  const reRefImg = /!\[[^\]]*\]\s*\[[^\]]*\]/g;
  while ((m = reRefImg.exec(body))) add('markdown-image-reference', m[0]);

  // Raw HTML unsafe tags (gfm-raw_html passes raw HTML through): media + script/link/style/base.
  const reTag = new RegExp(`<${UNSAFE_TAG}\\b[^>]*>`, 'gi');
  while ((m = reTag.exec(body))) add('raw-unsafe-tag', m[0]);

  // Include directives (SSI / Hugo / Quarto).
  const reSsi = /<!--\s*#include\b[\s\S]*?-->/gi;
  while ((m = reSsi.exec(body))) add('include-directive', m[0]);
  const reHugo = /\{\{<\s*include\b[\s\S]*?>\}\}/gi;
  while ((m = reHugo.exec(body))) add('include-directive', m[0]);

  return hits;
}

function htmlHits(text: string): ResourceHit[] {
  const hits: ResourceHit[] = [];
  const body = stripHtmlCode(text);
  const add = (kind: string, raw: string | undefined) => { if (raw !== undefined) hits.push({ kind, snippet: clip(raw) }); };
  let m: RegExpExecArray | null;

  // Resource-loading / execution tags. <a href> is deliberately absent (plain link).
  const reTag = new RegExp(`<${UNSAFE_TAG.replace('?:', '')}\\b[^>]*>`, 'gi');
  while ((m = reTag.exec(body))) {
    const tag = (m[1] ?? '').toLowerCase();
    add(tag === 'img' ? 'html-image' : `html-${tag}`, m[0]);
  }

  // CSS url(...) references (in <style> or style="" attributes), outside code.
  const reUrl = /url\s*\(\s*['"]?[^)'"]+['"]?\s*\)/gi;
  while ((m = reUrl.exec(body))) add('css-url', m[0]);

  // SSI include.
  const reSsi = /<!--\s*#include\b[\s\S]*?-->/gi;
  while ((m = reSsi.exec(body))) add('include-directive', m[0]);

  return hits;
}

export function findEmbeddedResources(kind: StructuredKind, text: string): ResourceHit[] {
  return kind === 'markdown' ? markdownHits(text) : htmlHits(text);
}

/** Throw FC_RESOURCE_BUNDLE_REQUIRED if the document is not standalone. */
export function assertStandalone(kind: StructuredKind, text: string): void {
  const hits = findEmbeddedResources(kind, text);
  if (hits.length > 0) {
    throw new ToolError(
      'FC_RESOURCE_BUNDLE_REQUIRED',
      'document references embedded/local/remote resources; v1 supports standalone single-file documents only',
      { resourceReferences: hits.slice(0, 10), total: hits.length },
    );
  }
}
