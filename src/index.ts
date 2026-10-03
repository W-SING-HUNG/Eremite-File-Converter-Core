/**
 * file-converter-core — public API surface (Host Contract v1.1, frozen).
 *
 * PRODUCTION engines: Sharp (images), Pandoc (structured), LibreOffice
 * (Office→PDF). The QA stub engine is DEV-only and lives under src/dev.
 *
 * The production protocol is the CLI:
 *   file-converter-core --protocol 1 --request <abs.json> --response <abs.json>
 * DEV/QA helpers (in-process convert / detect / capabilities / QA backend)
 * live in src/dev/api.ts and are NOT part of this production surface.
 */
import { ConversionCore, type CoreDeps } from './core/pipeline.js';
import { EngineRegistry } from './engines/registry.js';
import type { Engine } from './engines/base.js';
import { SharpEngine } from './engines/sharp.js';
import { PandocEngine } from './engines/pandoc.js';
import { LibreOfficeEngine } from './engines/libreoffice.js';
import type { HostInvocationRequest, HostInvocationResponse, HostWorkspace, HostSource, HostTarget, HostEnginePlan, HostLimits, FormatTriple, HostSuccessResponse, HostFailureResponse } from './core/types.js';
import type { SourceKind, TargetFormat } from './core/types.js';
import { assertSupportedRuntime } from './core/runtime-guard.js';
import { resolveHostWorkspace } from './workspace/host-workspace.js';
import type { ResolvedWorkspace } from './workspace/host-workspace.js';

export type {
  HostInvocationRequest, HostInvocationResponse, HostWorkspace, HostSource, HostTarget,
  HostEnginePlan, HostLimits, FormatTriple, HostSuccessResponse, HostFailureResponse,
  SourceKind, TargetFormat,
} from './core/types.js';
export type { WarningCode } from './core/warnings.js';
export { ToolError, ERROR_CODES, RECOVERY, PUBLIC_MESSAGE } from './core/errors.js';
export type { ErrorCode, RecoverySemantic, Stage, ErrorDTO } from './core/errors.js';
export { PUBLIC_WARNING_CODES } from './core/warnings.js';
// Core technical-support metadata (non-authoritative): the Core judges whether
// IT can technically execute a (from,to,engine) triple. Host authorization is
// the Host's responsibility and lives outside the Core.
export { assertTechnicallySupported, conversionIdFor, lookupTechnical } from './core/technical-support.js';
export { SharpEngine } from './engines/sharp.js';
export { PandocEngine } from './engines/pandoc.js';
export { LibreOfficeEngine } from './engines/libreoffice.js';
export { findEmbeddedResources, assertStandalone } from './engines/structured-resources.js';
export { EngineRegistry } from './engines/registry.js';
export { ConversionCore } from './core/pipeline.js';
export type { CoreDeps } from './core/pipeline.js';
export { resolveHostWorkspace } from './workspace/host-workspace.js';
export type { ResolvedWorkspace } from './workspace/host-workspace.js';

export interface FileConverter {
  /** PRODUCTION: run one Host invocation against an already-resolved Host workspace. */
  runHostInvocation(req: HostInvocationRequest, ws: ResolvedWorkspace): Promise<HostInvocationResponse>;
  /** Resolve + validate a Host workspace layout. */
  resolveWorkspace(req: HostInvocationRequest): Promise<ResolvedWorkspace>;
}

export interface CreateOptions extends Omit<CoreDeps, 'registry'> {
  /** Engines to register. Production default: [Sharp, Pandoc, LibreOffice]. */
  engines?: Engine[];
}

export function createFileConverter(deps: CreateOptions = {}): FileConverter {
  assertSupportedRuntime('file-converter-core');
  const { engines = [new SharpEngine(), new PandocEngine(), new LibreOfficeEngine()], ...rest } = deps;
  const core = new ConversionCore({ ...rest, registry: new EngineRegistry(engines) });
  return {
    runHostInvocation: (req, ws) => core.runHostInvocation(req, ws),
    resolveWorkspace: (req) => resolveHostWorkspace(req.workspace),
  };
}
