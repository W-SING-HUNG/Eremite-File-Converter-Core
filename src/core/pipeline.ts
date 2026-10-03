import path from 'node:path';
import { ToolError } from './errors.js';
import type {
  TargetFormat, Warning, RealTypeInfo, ImageOptions, SourceKind,
  HostInvocationRequest, HostInvocationResponse, HostLimits,
} from './types.js';
import type { ValidatorSummary } from './types.js';
import { LIMITS, TOOL_VERSION } from './constants.js';
import { isValidOperationId } from '../identity/operation-id.js';
import { basenameSafe } from '../identity/paths.js';
import { prepareScratch, removeScratch } from '../workspace/staging.js';
import { createCanonicalInput, createSnapshot, type SnapshotFaults } from '../snapshot/snapshot.js';
import { detectSnapshot } from '../detection/detect.js';
import { isLegalPair } from '../engines/base.js';
import type { EffectiveLimits } from '../engines/base.js';
import type { EngineRegistry } from '../engines/registry.js';
import { publishFixed } from '../workspace/fixed-publish.js';
import { validateOutput, type ValidationContext } from '../validation/validator.js';
import { assertTechnicallySupported, conversionIdFor } from './technical-support.js';
import { fmt } from './formats.js';
import type { QaDiagnosticsSink, ProvenanceSink } from './diagnostics.js';
import type { ResolvedWorkspace } from '../workspace/host-workspace.js';
import { assertRegularFileInside, assertFixedOutputTarget, assertInvocationWorkDir } from '../workspace/host-workspace.js';

const IMAGE_KINDS = new Set(['png', 'jpeg', 'webp', 'avif']);
const STRUCTURED_KINDS = new Set(['markdown', 'html']);
const VALID_TARGETS: TargetFormat[] = ['pdf', 'html', 'markdown', 'docx', 'png', 'jpeg', 'webp', 'avif'];
type SourceFamily = 'image' | 'text' | 'office';

export interface CoreDeps {
  registry: EngineRegistry;
  qaSink?: QaDiagnosticsSink;
  provenanceSink?: ProvenanceSink;
  now?: () => Date;
  snapshotFaults?: SnapshotFaults;
}

interface ThroughContext {
  invocationId: string;
  conversionId: string;
  target: TargetFormat;
  profile: string;
  engineId: string;
  sourcePath: string;
  expectedSha?: string;
  expectedSize?: number;
  engineDir: string; workDir: string; outDir: string; logsDir: string;
  limits: EffectiveLimits;
  imageOptions?: ImageOptions;
  sourceBasename: string;
  declaredKind?: SourceKind;
  // accumulated
  warnings: Warning[];
  detected?: RealTypeInfo;
  realType: string;
}

interface ValidatedOutcome {
  detected: RealTypeInfo;
  realType: SourceKind;
  sourceSha: string;
  sourceSize: number;
  validatedPath: string;
  validation: ValidatorSummary;
  engineVersion: string;
}

export class ConversionCore {
  constructor(private readonly deps: CoreDeps) {}

  // ── PRODUCTION: Host Contract v1.1 (frozen wire contract) ──────────────────
  async runHostInvocation(req: HostInvocationRequest, ws: ResolvedWorkspace): Promise<HostInvocationResponse> {
    const now = this.deps.now ?? (() => new Date());
    const t0 = now().getTime();
    const invocationId = req.invocationId;
    const conversionId = req.conversion.conversionId;
    const warnings: Warning[] = [];
    const finish = (): number => now().getTime() - t0;

    try {
      // 1. structural validation of the Host plan (frozen shape)
      if (req.kind !== 'request' || req.contractVersion !== 1) {
        throw new ToolError('FC_INVALID_REQUEST', undefined, undefined, 'request');
      }
      if (!isValidOperationId(invocationId)) {
        throw new ToolError('FC_INVALID_REQUEST', undefined, { field: 'invocationId' }, 'request');
      }
      const target = req.conversion.target.formatId;
      if (!VALID_TARGETS.includes(target)) throw new ToolError('FC_TARGET_UNSUPPORTED', undefined, undefined, 'request');

      const validated = assertTechnicallySupported(
        conversionId, target, req.conversion.enginePlan.primaryEngineId, req.conversion.enginePlan.fallbackEngineId ?? null,
      );
      const from = validated.from;
      const to = validated.to;
      const resolvedEngine = validated.engineId;
      // Frozen request has no profile field: image default 'balanced', office/pdf 'standard'.
      const resolvedProfile = resolvedEngine === 'libreoffice' ? 'standard' : 'balanced';

      // 2. workspace-contained fixed paths
      const sourceReal = await assertRegularFileInside(ws.inputDirReal, req.workspace.inputPath, 'source.inputPath');
      const fixedOut = await assertFixedOutputTarget(ws.outputDirReal, req.workspace.outputPath);

      // 3. scratch inside work/ — verified against a pre-created reparse/junction escape
      //    (work/<invocationId> -> external dir). Ancestors are checked, the dir is
      //    created, then re-lstat'ed and canonical containment re-confirmed.
      const scratchBase = await assertInvocationWorkDir(ws.rootReal, ws.workDir, invocationId);
      const dirs = await prepareScratch(scratchBase);

      const limits = this.makeLimits(from, req.limits, resolvedEngine);
      const runCtx: ThroughContext = {
        invocationId, conversionId, target: to, profile: resolvedProfile,
        engineId: resolvedEngine, sourcePath: sourceReal,
        expectedSha: req.source.sha256, expectedSize: req.source.byteSize,
        engineDir: dirs.engineDir, workDir: dirs.workDir, outDir: dirs.outDir, logsDir: ws.logsDir,
        limits, imageOptions: undefined, sourceBasename: basenameSafe(sourceReal),
        declaredKind: from,
        warnings, realType: 'unknown',
      };

      const outcome = await this.throughValidation(runCtx);
      const pub = await publishFixed({ validatedOutputPath: outcome.validatedPath, fixedOutputPath: fixedOut });

      const durationMs = finish();
      return {
        kind: 'response', contractVersion: 1, invocationId, status: 'succeeded',
        coreVersion: TOOL_VERSION,
        sourceSha256: outcome.sourceSha,
        detectedSource: fmt(outcome.realType),
        target: fmt(to),
        output: { byteSize: pub.sizeBytes, sha256: pub.sha256, detectedType: fmt(to) },
        // Canonical: engine carries id+version ONLY; fallback is a TOP-LEVEL object.
        engine: { id: resolvedEngine, version: outcome.engineVersion ?? 'unknown' },
        fallback: { used: false },
        durationMs,
        warnings,
      };
    } catch (e) {
      const err = e instanceof ToolError ? e : new ToolError('FC_INTERNAL_ERROR', undefined, undefined, 'internal');
      const durationMs = finish();
      return {
        kind: 'response', contractVersion: 1, invocationId, status: 'failed', coreVersion: TOOL_VERSION,
        durationMs, warnings, errors: [err.toJSON()],
      };
    } finally {
      // Scratch is always removed: success, business failure, timeout or crash.
      const scratchBase = path.join(ws.workDir, invocationId);
      await removeScratch(scratchBase).catch(() => {});
    }
  }

  /** Effective per-invocation limits (Host envelope clamped onto built-in caps). */
  makeLimits(from: SourceKind, env: HostLimits | undefined, engine: string): EffectiveLimits {
    const family: SourceFamily = IMAGE_KINDS.has(from) ? 'image' : STRUCTURED_KINDS.has(from) ? 'text' : 'office';
    const builtSource = family === 'image' ? LIMITS.maxSourceBytes.image : family === 'text' ? LIMITS.maxSourceBytes.text : LIMITS.maxSourceBytes.office;
    const timeoutDefault = engine === 'libreoffice' ? LIMITS.timeoutMs.libreoffice : engine === 'pandoc' ? LIMITS.timeoutMs.pandoc : LIMITS.timeoutMs.sharp;
    return {
      maxSourceBytes: Math.min(env?.maxInputBytes ?? builtSource, LIMITS.maxSourceBytesGlobal),
      timeoutMs: Math.min(env?.timeoutMs ?? timeoutDefault, LIMITS.timeoutMs.hardCap),
      maxDecodedPixels: LIMITS.imageMemory.maxDecodedPixels,
      maxOutputBufferBytes: Math.min(env?.maxOutputBytes ?? LIMITS.imageMemory.maxOutputBufferBytes, LIMITS.imageMemory.maxOutputBufferBytes),
    };
  }

  /** Snapshot → host hash/size verify → detect → canonical → exact engine → validate. */
  private async throughValidation(ctx: ThroughContext): Promise<ValidatedOutcome> {
    // immutable snapshot (host-provided hash/size are recomputed and verified)
    const snap = await createSnapshot(ctx.sourcePath, ctx.engineDir + '_snap', this.deps.snapshotFaults);
    if (ctx.expectedSha && snap.sha256 !== ctx.expectedSha) {
      throw new ToolError('FC_SOURCE_CHANGED', undefined, { reason: 'source sha256 does not match Host-provided value' }, 'input');
    }
    if (ctx.expectedSize !== undefined && snap.sizeBytes !== ctx.expectedSize) {
      throw new ToolError('FC_SOURCE_CHANGED', undefined, { reason: 'source byteSize does not match Host-provided value' }, 'input');
    }

    const det = await detectSnapshot(snap.snapshotPath, ctx.sourceBasename, ctx.declaredKind);
    ctx.warnings.push(...det.info.warnings);
    ctx.detected = det.info;
    ctx.realType = det.info.kind;
    if (det.rejection) throw det.rejection;
    if (det.info.kind === 'unknown') throw new ToolError('FC_SOURCE_UNSUPPORTED', undefined, undefined, 'detection');
    if (!isLegalPair(det.info.kind, ctx.target)) throw new ToolError('FC_TARGET_UNSUPPORTED', undefined, undefined, 'detection');
    // conversionId must agree with the detected real type (defense in depth)
    if (conversionIdFor(det.info.kind, ctx.target) !== ctx.conversionId) {
      throw new ToolError('FC_TARGET_UNSUPPORTED', undefined, { reason: 'conversionId does not match detected real type' }, 'detection');
    }

    const canonical = await createCanonicalInput(snap.snapshotPath, ctx.engineDir, det.info.kind, snap.sha256);

    const resolved = await this.deps.registry.resolveExact(ctx.engineId, { from: det.info.kind, to: ctx.target });
    if (!resolved.engine) {
      throw new ToolError('FC_DEPENDENCY_MISSING', undefined, { engine: ctx.engineId }, 'engine');
    }
    const run = await resolved.engine.run({
      operationId: ctx.invocationId, canonicalInputPath: canonical, from: det.info.kind,
      to: ctx.target, profile: ctx.profile, workDir: ctx.workDir, outDir: ctx.outDir, logsDir: ctx.logsDir,
      limits: ctx.limits, imageOptions: ctx.imageOptions,
    });
    ctx.warnings.push(...run.warnings);
    if (run.diagnostics) this.deps.qaSink?.emit({ operationId: ctx.invocationId, stages: [], logs: [] });

    const validationCtx: ValidationContext | undefined = IMAGE_KINDS.has(det.info.kind)
      ? {
          kind: 'image', sourceCanonicalPath: canonical, target: ctx.target, profile: ctx.profile,
          metadataPolicy: ctx.imageOptions?.metadata ?? 'strip',
          expectedWidth: run.validationHints?.expectedWidth as number | undefined,
          expectedHeight: run.validationHints?.expectedHeight as number | undefined,
          sourceHasAlpha: run.validationHints?.sourceHasAlpha as boolean | undefined,
        }
      : STRUCTURED_KINDS.has(det.info.kind)
        ? { kind: 'structured', sourceKind: det.info.kind as 'markdown' | 'html', target: ctx.target }
        : undefined;
    const validation = await validateOutput(run.outputPath, ctx.target, validationCtx);
    if (!validation.passed) {
      throw new ToolError('FC_OUTPUT_VALIDATION_FAILED', undefined, { failedChecks: validation.checks.filter((c) => !c.passed).map((c) => c.name) }, 'output');
    }
    return {
      detected: det.info, realType: det.info.kind, sourceSha: snap.sha256, sourceSize: snap.sizeBytes,
      validatedPath: run.outputPath, validation, engineVersion: run.engineVersion,
    };
  }
}
