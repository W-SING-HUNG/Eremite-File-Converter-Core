import fsp from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from '../core/errors.js';
import { LIMITS } from '../core/constants.js';
import type { RealTypeInfo, SourceKind, Warning } from '../core/types.js';
import type { WarningCode } from '../core/warnings.js';
import { longPath } from '../identity/paths.js';
import { assessZipSafety, readZipEntries, ZipParseError } from './zip-container.js';
import { isCfb, isEncryptedPackage } from './cfb.js';
import { findUnsafeExternalRels } from './ooxml-rels.js';

export interface DetectionOutcome {
  info: RealTypeInfo;
  /** Terminal rejection discovered on the snapshot (malformed/unsafe/macro/encrypted). */
  rejection?: ToolError;
}

const MACRO_EXT = new Set(['.docm', '.xlsm', '.pptm']);

function warn(code: WarningCode): Warning {
  return { code };
}

function matchMagic(head: Buffer): { kind: SourceKind; magic: string } | null {
  if (head.length >= 8 && head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { kind: 'png', magic: 'image/png' };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'jpeg', magic: 'image/jpeg' };
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'webp', magic: 'image/webp' };
  }
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return { kind: 'avif', magic: 'image/avif' };
  }
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'PK\x03\x04') return { kind: 'docx', magic: 'application/zip' }; // precise kind decided by container
  return null;
}

const REQUIRED_PART: Record<'docx' | 'xlsx' | 'pptx', string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};

function detectOoxmlKind(names: Set<string>): SourceKind | null {
  for (const k of ['docx', 'xlsx', 'pptx'] as const) {
    if (names.has(REQUIRED_PART[k]) || names.has('/' + REQUIRED_PART[k])) return k;
  }
  return null;
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 4096);
  return /<!doctype html/i.test(head) || /<html[\s>]/i.test(head) || /<(head|body)\b/i.test(head) || /<a\b[^>]*href=/i.test(head);
}

export async function detectSnapshot(
  snapshotPath: string,
  originalBasename: string,
  declaredKind?: SourceKind | null,
): Promise<DetectionOutcome> {
  const extHint = path.extname(originalBasename).toLowerCase() || null;
  const warnings: Warning[] = [];
  const fd = await fsp.open(longPath(snapshotPath), 'r');
  try {
    const head = Buffer.alloc(65_536);
    const { bytesRead } = await fd.read(head, 0, head.length, 0);
    const headView = head.subarray(0, bytesRead);

    // CFB: legacy binary Office or encrypted OOXML package.
    if (isCfb(headView)) {
      const whole = await fsp.readFile(longPath(snapshotPath));
      if (isEncryptedPackage(whole)) {
        return { info: info('unknown', extHint, null, 'cfb', warnings), rejection: new ToolError('FC_ENCRYPTED_PROTECTED', 'encrypted/password-protected package') };
      }
      return { info: info('unknown', extHint, null, 'cfb', warnings), rejection: new ToolError('FC_SOURCE_UNSUPPORTED', 'legacy binary Office format is not supported in v1') };
    }

    const magic = matchMagic(headView);

    // ZIP / OOXML path — needs central directory (near end of file), read whole capped buffer.
    if (magic && magic.magic === 'application/zip') {
      const whole = await fsp.readFile(longPath(snapshotPath));
      let entries;
      try {
        entries = readZipEntries(whole);
      } catch (e) {
        const reason = e instanceof ZipParseError ? e.message : 'unreadable zip';
        return { info: info('unknown', extHint, 'application/zip', null, warnings), rejection: new ToolError('FC_SOURCE_CORRUPT', `broken ZIP container: ${reason}`) };
      }
      const names = new Set(entries.map((e) => e.name.replace(/\\/g, '/').replace(/^\//, '')));
      const safety = assessZipSafety(entries, LIMITS.archive);
      if (safety.unsafe) {
        return { info: info('unknown', extHint, 'application/zip', 'ooxml', warnings), rejection: new ToolError('FC_SOURCE_CORRUPT', `archive rejected: ${safety.reason}`, { ratio: Math.round(safety.ratio) }) };
      }
      if (!names.has('[Content_Types].xml')) {
        return { info: info('unknown', extHint, 'application/zip', null, warnings), rejection: new ToolError('FC_SOURCE_CORRUPT', 'ZIP is not an OOXML package ([Content_Types].xml missing)') };
      }
      const hasVba = [...names].some((n) => /(^|\/)vbaProject\.bin$/.test(n));
      if (hasVba || (extHint && MACRO_EXT.has(extHint))) {
        return { info: info('unknown', extHint, 'application/zip', 'ooxml', warnings), rejection: new ToolError('FC_MACRO_UNSUPPORTED', 'macro-enabled documents are rejected in v1') };
      }
      const kind = detectOoxmlKind(names);
      if (!kind) {
        return { info: info('unknown', extHint, 'application/zip', 'ooxml', warnings), rejection: new ToolError('FC_SOURCE_CORRUPT', 'OOXML required part missing') };
      }
      // External-relationship policy: allow ordinary hyperlinks, block all
      // other External relationships (fail-closed for unknown types).
      const unsafeRels = findUnsafeExternalRels(whole, entries);
      if (unsafeRels.length > 0) {
        return {
          info: info(kind, extHint, 'application/zip', 'ooxml', warnings),
          rejection: new ToolError('FC_EXTERNAL_REL_BLOCKED',
            'OOXML package references external/linked resources that v1 blocks before conversion',
            { references: unsafeRels.slice(0, 10), total: unsafeRels.length }),
        };
      }
      if (extHint && !extMatchesKind(extHint, kind)) warnings.push(warn('FC_EXTENSION_MISMATCH'));
      return { info: info(kind, extHint, 'application/zip', 'ooxml', warnings) };
    }

    if (magic) {
      if (extHint && !extMatchesKind(extHint, magic.kind)) warnings.push(warn('FC_EXTENSION_MISMATCH'));
      return { info: info(magic.kind, extHint, magic.magic, 'none', warnings) };
    }

    // Text path: markdown/html have no binary signature. The extension hint wins;
    // for the extension-less fixed Host input, the Host-declared source kind
    // (from the accepted conversionId) disambiguates plain UTF-8 text.
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(headView);
    if (extHint === '.html' || extHint === '.htm' || looksLikeHtml(decoded) || declaredKind === 'html') {
      return { info: info('html', extHint, 'text/html', 'none', warnings) };
    }
    if (extHint === '.md' || extHint === '.markdown' || declaredKind === 'markdown') {
      return { info: info('markdown', extHint, 'text/markdown', 'none', warnings) };
    }
    return { info: info('unknown', extHint, null, null, warnings), rejection: new ToolError('FC_SOURCE_UNSUPPORTED', 'unrecognized file type') };
  } catch (e) {
    if (e instanceof TypeError) {
      return { info: info('unknown', extHint, null, null, warnings), rejection: new ToolError('FC_SOURCE_CORRUPT', 'file is not valid UTF-8 text') };
    }
    throw e;
  } finally {
    await fd.close();
  }
}

function info(kind: SourceKind | 'unknown', extensionHint: string | null, magic: string | null, container: RealTypeInfo['signals']['container'], warnings: Warning[]): RealTypeInfo {
  return { kind, extensionHint, signals: { extension: extensionHint, magic, container }, warnings };
}

function extMatchesKind(ext: string, kind: SourceKind): boolean {
  const map: Record<string, SourceKind> = {
    '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx',
    '.md': 'markdown', '.markdown': 'markdown', '.html': 'html', '.htm': 'html',
    '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.avif': 'avif',
  };
  return map[ext] === kind;
}

export const CANONICAL_EXT: Record<SourceKind, string> = {
  docx: '.docx', xlsx: '.xlsx', pptx: '.pptx',
  markdown: '.md', html: '.html',
  png: '.png', jpeg: '.jpg', webp: '.webp', avif: '.avif',
};
