import { describe, it, expect } from 'vitest';
import {
  TECHNICAL_CONVERSIONS, lookupTechnical, assertTechnicallySupported, conversionIdFor,
} from '../src/core/technical-support.js';
import { ToolError } from '../src/core/errors.js';

// Derived with the same canonical spelling helper the Core uses, so the test
// never hardcodes the id format.
const IMAGE_KINDS = ['png', 'jpeg', 'webp', 'avif'] as const;
const IMAGE_IDS = IMAGE_KINDS.flatMap((a) =>
  IMAGE_KINDS.filter((b) => a !== b).map((b) => conversionIdFor(a, b)));

function expectThrow(fn: () => unknown, code: string): void {
  try { fn(); } catch (e) { expect((e as ToolError).code).toBe(code); return; }
  throw new Error('expected throw');
}

describe('Core technical-support (exactly 18, non-authoritative)', () => {
  it('lists exactly 12 image + 3 structured + 3 office = 18 ids', () => {
    const ids = TECHNICAL_CONVERSIONS.map((c) => c.id);
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(18);
    expect(ids.filter((i) => IMAGE_IDS.includes(i))).toHaveLength(12);
    expect(ids).toContain('markdown-to-html');
    expect(ids).toContain('html-to-markdown');
    expect(ids).toContain('markdown-to-docx');
    expect(ids).toContain('docx-to-pdf');
    expect(ids).toContain('xlsx-to-pdf');
    expect(ids).toContain('pptx-to-pdf');
  });

  it('does NOT list DOCX->Markdown, PDF->Office, self-conversions, or microsoft engines', () => {
    const ids = TECHNICAL_CONVERSIONS.map((c) => c.id);
    expect(ids).not.toContain('docx-to-markdown');
    expect(ids).not.toContain('pdf-to-docx');
    expect(ids).not.toContain('png-to-png');
    for (const c of TECHNICAL_CONVERSIONS) {
      expect(['sharp', 'pandoc', 'libreoffice']).toContain(c.engine);
    }
  });

  it('image pairs default to balanced profile; pandoc/libreoffice to standard', () => {
    for (const c of TECHNICAL_CONVERSIONS) {
      if (c.engine === 'sharp') expect(c.defaultProfile).toBe('balanced');
      else expect(c.defaultProfile).toBe('standard');
    }
  });

  it('rejects any plan that names a runtime fallback engine (v1.1 has none)', () => {
    expectThrow(() => assertTechnicallySupported('docx-to-pdf', 'pdf', 'libreoffice', 'pandoc'), 'FC_UNSUPPORTED_FEATURE');
  });

  it('accepts a valid technical plan', () => {
    const p = assertTechnicallySupported('png-to-webp', 'webp', 'sharp', null);
    expect(p.engineId).toBe('sharp');
    expect(p.from).toBe('png');
    expect(p.to).toBe('webp');
  });

  it('rejects an unapproved conversionId (unknown pair)', () => {
    expectThrow(() => assertTechnicallySupported('gif-to-png', 'png', 'sharp', null), 'FC_UNSUPPORTED_FEATURE');
  });

  it('rejects an unapproved engine for the pair', () => {
    expectThrow(() => assertTechnicallySupported('png-to-webp', 'webp', 'magick', null), 'FC_UNSUPPORTED_FEATURE');
  });

  it('rejects target/conversion mismatch', () => {
    expectThrow(() => assertTechnicallySupported('png-to-webp', 'jpeg', 'sharp', null), 'FC_TARGET_UNSUPPORTED');
  });

  it('conversionIdFor is deterministic', () => {
    expect(conversionIdFor('markdown', 'html')).toBe('markdown-to-html');
  });

  it('lookupTechnical returns the technical record for known ids', () => {
    expect(lookupTechnical('docx-to-pdf')?.engine).toBe('libreoffice');
    expect(lookupTechnical('nope-to-nope')).toBeUndefined();
  });
});
