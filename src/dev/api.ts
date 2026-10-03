/**
 * DEV/QA ONLY API surface. Not the production protocol. Imported by the QA CLI
 * backend / tests. The production `file-converter-core` binary exposes ONLY the
 * frozen Host Contract v1.1 protocol (see src/protocol/run-protocol.ts) and
 * never reaches these DEV helpers.
 *
 * The QA stub engine is imported directly here (it is NOT in the production
 * public exports).
 */
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { ToolError } from '../core/errors.js';
import { ConversionCore, type CoreDeps } from '../core/pipeline.js';
import { EngineRegistry } from '../engines/registry.js';
import { SharpEngine } from '../engines/sharp.js';
import { PandocEngine } from '../engines/pandoc.js';
import { LibreOfficeEngine } from '../engines/libreoffice.js';
import type { Engine } from '../engines/base.js';
import { TARGET_EXT, isLegalPair } from '../engines/base.js';
import { LIMITS } from '../core/constants.js';
import { resolveOperationId, isValidOperationId } from '../identity/operation-id.js';
import { assertOutputDirectory, assertRegularLocalFile, basenameSafe, sanitizeFilenameStem } from '../identity/paths.js';
import { prepareScratch, removeScratch } from '../workspace/staging.js';
import { createCanonicalInput, createSnapshot } from '../snapshot/snapshot.js';
import { detectSnapshot } from '../detection/detect.js';
import { validateOutput, type ValidationContext } from '../validation/validator.js';
import { buildCompactProvenance } from '../core/provenance.js';
import { conversionIdFor, lookupTechnical } from '../core/technical-support.js';
import { publish } from './publish.js';
import type {
  Capabilities, RealTypeInfo, EngineInfo, Warning, ImageOptions, SourceKind, TargetFormat, CompactProvenance, HostLimits,
} from '../core/types.js';
import type { ConvertRequest, ConvertResult } from './types.js';

const IMAGE_KINDS = new Set(['png', 'jpeg', 'webp', 'avif']);
const STRUCTURED_KINDS = new Set(['markdown', 'html']);
const VALID_TARGETS: TargetFormat[] = ['pdf', 'html', 'markdown', 'docx', 'png', 'jpeg', 'webp', 'avif'];

export type {
  Capabilities, RealTypeInfo, EngineInfo, Warning,
  CompactProvenance, SourceKind, TargetFormat, ImageOptions,
} from '../core/types.js';
export type { ConvertRequest, ConvertResult, ConflictMode } from './types.js';
export type { WarningCode } from '../core/warnings.js';
export { ConversionCore, EngineRegistry, SharpEngine, PandocEngine, LibreOfficeEngine };

export interface DevDeps extends Omit<CoreDeps, 'registry'> {
  /** Engines to register. DEV default: [Sharp, Pandoc, LibreOffice]. */
  engines?: Engine[];
}

/** DEV-only converter (legacy in-process convert / detect / capabilities). Not the production protocol. */
export interface DevConverter {
  convert(req: ConvertRequest): Promise<ConvertResult>;
  detectFile(sourcePath: string): Promise<unknown>;
  getCapabilities(): Promise<Capabilities>;
  probeEngines(): Promise<EngineInfo[]>;
}

class DevConverterImpl implements DevConverter {
  constructor(
    private readonly core: ConversionCore,
    private readonly registry: EngineRegistry,
    private readonly deps: CoreDeps,
  ) {}

  async convert(req: ConvertRequest): Promise<ConvertResult> {
    const now = this.deps.now ?? (() => new Date());
    const startedAt = now().toISOString();
    const t0 = now().getTime();
    const suppliedOpId = req.operationId;
    const invalidOpId = suppliedOpId !== undefined && !isValidOperationId(suppliedOpId);
    const operationId = resolveOperationId(invalidOpId ? undefined : suppliedOpId);
    const warnings: Warning[] = [];
    let detected: RealTypeInfo | undefined;
    let sourceSha = '';
    let sourceSize = 0;
    let actualVersion: string | null = null;
    let realType = 'unknown';
    const profile = req.profile ?? 'standard';
    const devRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-dev-'));
    const finish = () => { const e = now(); return { endedAt: e.toISOString(), durationMs: e.getTime() - t0 }; };

    const fail = (error: ToolError): ConvertResult => {
      const provenance = buildCompactProvenance({
        invocationId: operationId, conversionId: `dev-to-${req.targetFormat}`, startedAt, ...finish(),
        sourceBasename: basenameSafe(req.sourcePath), realType, sourceSize, sourceSha,
        target: req.targetFormat, profile, actualEngine: null, actualVersion, warnings, errorCode: error.code,
      });
      this.deps.provenanceSink?.emit(provenance);
      return {
        status: 'failed', operationId, ...(detected ? { detectedSourceType: detected } : {}),
        error: { code: error.code, message: error.message, recovery: error.recovery, ...(error.details ? { details: error.details } : {}) }, engine: {}, timing: { startedAt, ...finish() }, warnings, provenance,
      };
    };

    try {
      if (invalidOpId) throw new ToolError('FC_INVALID_REQUEST', undefined, { field: 'operationId' });
      if (!req?.sourcePath || !req.output?.directory) throw new ToolError('FC_INVALID_REQUEST');
      if (!VALID_TARGETS.includes(req.targetFormat)) throw new ToolError('FC_TARGET_UNSUPPORTED');
      if (req.timeoutMs !== undefined && (req.timeoutMs <= 0 || req.timeoutMs > LIMITS.timeoutMs.hardCap)) {
        throw new ToolError('FC_INVALID_REQUEST', undefined, { field: 'timeoutMs' });
      }
      const conflict = req.output.conflict ?? 'reject';
      const destDir = await assertOutputDirectory(req.output.directory);
      await assertRegularLocalFile(req.sourcePath);
      const dirs = await prepareScratch(path.join(devRoot, operationId));

      const snap = await createSnapshot(req.sourcePath, dirs.engineDir + '_snap', this.deps.snapshotFaults);
      sourceSha = snap.sha256; sourceSize = snap.sizeBytes;
      const det = await detectSnapshot(snap.snapshotPath, basenameSafe(req.sourcePath));
      warnings.push(...det.info.warnings);
      detected = det.info; realType = det.info.kind;
      if (det.rejection) throw det.rejection;
      if (det.info.kind === 'unknown') throw new ToolError('FC_SOURCE_UNSUPPORTED');
      if (!isLegalPair(det.info.kind, req.targetFormat)) throw new ToolError('FC_TARGET_UNSUPPORTED');

      const tech = lookupTechnical(conversionIdFor(det.info.kind, req.targetFormat));
      // DEV: 'standard' (or omitted) resolves to the technical default profile
      // (images default to balanced; office/pandoc default to standard). Profile
      // validity beyond that is enforced by the engine itself.
      const devProfile = (!req.profile || req.profile === 'standard') ? (tech?.defaultProfile ?? 'standard') : req.profile;

      const canonical = await createCanonicalInput(snap.snapshotPath, dirs.engineDir, det.info.kind, sourceSha);
      const preferred = tech?.engine ?? (req.enginePolicy?.preferred && req.enginePolicy.preferred !== 'auto' ? req.enginePolicy.preferred : undefined);
      const resolved = await this.registry.resolveDev({ from: det.info.kind, to: req.targetFormat }, preferred);
      if (!resolved.engine) throw new ToolError('FC_DEPENDENCY_MISSING', undefined, { engine: preferred });
      const engineId = resolved.engine.id;
      const devLimits: HostLimits | undefined = req.timeoutMs !== undefined
        ? { maxInputBytes: LIMITS.maxSourceBytesGlobal, maxOutputBytes: LIMITS.imageMemory.maxOutputBufferBytes, maxWorkspaceBytes: LIMITS.maxSourceBytesGlobal, timeoutMs: req.timeoutMs }
        : undefined;
      const limits = this.core.makeLimits(det.info.kind, devLimits, engineId);
      const run = await resolved.engine.run({
        operationId, canonicalInputPath: canonical, from: det.info.kind, to: req.targetFormat,
        profile: devProfile, workDir: dirs.workDir, outDir: dirs.outDir, logsDir: devRoot, limits, imageOptions: req.imageOptions,
      });
      warnings.push(...run.warnings);
      actualVersion = run.engineVersion;

      const vctx: ValidationContext | undefined = IMAGE_KINDS.has(det.info.kind)
        ? { kind: 'image', sourceCanonicalPath: canonical, target: req.targetFormat, profile: devProfile, metadataPolicy: req.imageOptions?.metadata ?? 'strip',
            expectedWidth: run.validationHints?.expectedWidth as number, expectedHeight: run.validationHints?.expectedHeight as number,
            sourceHasAlpha: run.validationHints?.sourceHasAlpha as boolean }
        : STRUCTURED_KINDS.has(det.info.kind)
          ? { kind: 'structured', sourceKind: det.info.kind as 'markdown' | 'html', target: req.targetFormat } : undefined;
      const validation = await validateOutput(run.outputPath, req.targetFormat, vctx);
      if (!validation.passed) throw new ToolError('FC_OUTPUT_VALIDATION_FAILED', undefined, { failedChecks: validation.checks.filter((c) => !c.passed).map((c) => c.name) });

      const stem = sanitizeFilenameStem(req.output.filename ?? path.basename(req.sourcePath, path.extname(req.sourcePath))) || operationId;
      const pub = await publish({
        validatedOutputPath: run.outputPath, destinationDir: destDir, baseStem: stem,
        extension: TARGET_EXT[req.targetFormat], conflict, operationId,
      });
      const tm = finish();
      const provenance = buildCompactProvenance({
        invocationId: operationId, conversionId: conversionIdFor(det.info.kind, req.targetFormat), startedAt, ...tm,
        sourceBasename: basenameSafe(req.sourcePath), realType, sourceSize, sourceSha, target: req.targetFormat,
        profile: devProfile, actualEngine: engineId, actualVersion, warnings,
        output: { sizeBytes: pub.sizeBytes, sha256: pub.sha256, validator: validation.validator },
      });
      this.deps.provenanceSink?.emit(provenance);
      return {
        status: 'succeeded', operationId, detectedSourceType: det.info, targetFormat: req.targetFormat,
        output: { path: pub.path, sizeBytes: pub.sizeBytes, sha256: pub.sha256 },
        engine: { actual: engineId, actualVersion: actualVersion! },
        profile: devProfile, warnings, totalWarningCount: warnings.length,
        source: { sizeBytes: sourceSize, sha256: sourceSha }, timing: { startedAt, ...tm }, validation, provenance,
      };
    } catch (e) {
      return fail(e instanceof ToolError ? e : new ToolError('FC_INTERNAL_ERROR'));
    } finally {
      await removeScratch(devRoot).catch(() => {});
    }
  }

  async detectFile(sourcePath: string): Promise<unknown> {
    await assertRegularLocalFile(sourcePath);
    const operationId = resolveOperationId(undefined);
    const devRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-dev-detect-'));
    try {
      const dirs = await prepareScratch(path.join(devRoot, operationId));
      const snap = await createSnapshot(sourcePath, dirs.engineDir + '_snap');
      const det = await detectSnapshot(snap.snapshotPath, basenameSafe(sourcePath));
      return { sha256: snap.sha256, sizeBytes: snap.sizeBytes, ...det.info, ...(det.rejection ? { rejection: det.rejection.toJSON() } : {}) };
    } finally {
      await removeScratch(devRoot).catch(() => {});
    }
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      runtime: { node: process.version, platform: process.platform, baseline: 'node-24-lts' as const },
      engines: await this.registry.describe(),
      availableConversions: await this.registry.availablePairs(),
    };
  }

  async probeEngines(): Promise<EngineInfo[]> {
    return this.registry.describe();
  }
}

function defaultEngines(): Engine[] {
  return [new SharpEngine(), new PandocEngine(), new LibreOfficeEngine()];
}

export function createDevConverter(deps: DevDeps = {}): DevConverter {
  const { engines, ...rest } = deps;
  const used = engines ?? defaultEngines();
  const registry = new EngineRegistry(used);
  const core = new ConversionCore({ ...rest, registry });
  return new DevConverterImpl(core, registry, { ...rest, registry });
}

export function devConvert(req: ConvertRequest, deps?: DevDeps): Promise<ConvertResult> {
  return createDevConverter(deps).convert(req);
}
export function devDetect(sourcePath: string, deps?: DevDeps): Promise<unknown> {
  return createDevConverter(deps).detectFile(sourcePath);
}
export function devCapabilities(deps?: DevDeps): Promise<Capabilities> {
  return createDevConverter(deps).getCapabilities();
}
export function devProbeEngines(deps?: DevDeps): Promise<EngineInfo[]> {
  return createDevConverter(deps).probeEngines();
}
