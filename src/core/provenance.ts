import { LIMITS, TOOL_NAME, TOOL_VERSION } from './constants.js';
import type { CompactProvenance, TargetFormat, Warning } from './types.js';
import type { ErrorCode } from './errors.js';

export interface ProvenanceInput {
  invocationId: string;
  conversionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sourceBasename: string;
  realType: string;
  sourceSize: number;
  sourceSha: string;
  target: TargetFormat;
  profile: string;
  actualEngine: string | null;
  actualVersion: string | null;
  warnings: Warning[];
  errorCode?: ErrorCode;
  output?: { sizeBytes: number; sha256: string; validator: string };
}

/** Compact, persistence-safe provenance (≤16 KiB hard cap, basenames only, FC_* codes only). */
export function buildCompactProvenance(inp: ProvenanceInput): CompactProvenance {
  const kept = inp.warnings.slice(0, LIMITS.compactWarningsKept).map((w) => w.code);
  const prov: CompactProvenance = {
    schemaVersion: '1.1',
    invocationId: inp.invocationId,
    conversionId: inp.conversionId,
    startedAt: inp.startedAt,
    endedAt: inp.endedAt,
    durationMs: inp.durationMs,
    conversion: { source: inp.sourceBasename, target: inp.target, profile: inp.profile },
    source: { realType: inp.realType, sizeBytes: inp.sourceSize, sha256: inp.sourceSha },
    engine: { actual: inp.actualEngine, actualVersion: inp.actualVersion },
    warnings: kept,
    ...(inp.errorCode ? { errorCode: inp.errorCode } : {}),
    ...(inp.output ? { output: inp.output } : {}),
    tool: { name: TOOL_NAME, version: TOOL_VERSION, runtime: 'node-24-lts' },
  };
  const serialized = JSON.stringify(prov);
  if (Buffer.byteLength(serialized, 'utf8') > LIMITS.compactResultMaxSerializedBytes) {
    throw new Error('compact provenance exceeds 16 KiB cap');
  }
  return prov;
}
