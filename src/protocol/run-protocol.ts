/**
 * Production protocol runner (Host Contract v1.1 §1).
 *
 *   file-converter-core --protocol 1 --request <abs.json> --response <abs.json>
 *
 * Exit semantics:
 *   0        = a schema-valid response was written (status "succeeded" OR "failed")
 *   non-zero = protocol/crash failure: no trusted/legal response could be produced
 *              (bad CLI flags, unreadable/invalid request, unwritable response path,
 *               unattributable crash, or request/response path escaping the workspace).
 *              Business conversion errors are NEVER non-zero.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ToolError } from '../core/errors.js';
import { isValidOperationId } from '../identity/operation-id.js';
import { TOOL_NAME, TOOL_VERSION, PROTOCOL_MAJOR } from '../core/constants.js';
import { createFileConverter } from '../index.js';
import type { HostInvocationRequest, HostInvocationResponse, HostFailureResponse } from '../core/types.js';
import { assertInsideWorkspace } from '../workspace/host-workspace.js';

export interface ProtocolArgs {
  protocol: number;
  requestPath: string;
  responsePath: string;
}

export function parseProtocolArgs(argv: string[]): ProtocolArgs {
  let protocol: number | null = null;
  let requestPath: string | null = null;
  let responsePath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--protocol') protocol = Number(argv[++i]);
    else if (a === '--request') requestPath = argv[++i] ?? null;
    else if (a === '--response') responsePath = argv[++i] ?? null;
    else throw new Error(`unknown protocol argument: ${a}`);
  }
  if (protocol !== PROTOCOL_MAJOR) throw new Error('--protocol must be 1');
  if (!requestPath || !path.isAbsolute(requestPath)) throw new Error('--request must be an absolute path');
  if (!responsePath || !path.isAbsolute(responsePath)) throw new Error('--response must be an absolute path');
  return { protocol, requestPath, responsePath };
}

function isAttributableRequest(req: unknown): req is HostInvocationRequest {
  if (!req || typeof req !== 'object') return false;
  const r = req as Record<string, unknown>;
  return r.kind === 'request' && r.contractVersion === 1 && isValidOperationId(r.invocationId as string)
    && typeof (r.conversion as Record<string, unknown> | undefined)?.conversionId === 'string';
}

function unattributedFailure(req: HostInvocationRequest, err: ToolError, durationMs: number): HostFailureResponse {
  return {
    kind: 'response', contractVersion: 1,
    invocationId: req.invocationId, status: 'failed',
    coreVersion: TOOL_VERSION, durationMs, warnings: [],
    errors: [err.toJSON()],
  };
}

/** Lightweight schema gate: the response we are about to hand to the Host. */
function assertSchemaValidResponse(resp: HostInvocationResponse): void {
  if (resp.kind !== 'response') throw new Error('response kind mismatch');
  if (resp.contractVersion !== 1) throw new Error('response contractVersion mismatch');
  if (!isValidOperationId(resp.invocationId)) throw new Error('response invocationId invalid');
  if (resp.status !== 'succeeded' && resp.status !== 'failed') throw new Error('response status invalid');
  if (typeof resp.coreVersion !== 'string') throw new Error('response coreVersion missing');
  if (typeof resp.durationMs !== 'number') throw new Error('response durationMs missing');
  if (!Array.isArray(resp.warnings)) throw new Error('response warnings missing');
  if (resp.status === 'succeeded') {
    if (!resp.output?.sha256 || typeof resp.output?.byteSize !== 'number' || !resp.engine?.id) {
      throw new Error('success response incomplete');
    }
    // Canonical: `fallback` is a TOP-LEVEL object; `engine` carries id+version only.
    if (!resp.engine?.version) throw new Error('success response engine.version missing');
    if (!resp.fallback || resp.fallback.used !== false) {
      throw new Error('fallback must be a top-level object with used=false in v1.1');
    }
  } else {
    if (!Array.isArray(resp.errors) || !resp.errors[0]?.code?.startsWith('FC_')) {
      throw new Error('failure response error code must be FC_*');
    }
  }
}

async function writeResponseAtomic(responsePath: string, resp: HostInvocationResponse): Promise<void> {
  const dir = path.dirname(responsePath);
  const tmp = path.join(dir, `.fctmp-response-${randomBytes(6).toString('hex')}.json`);
  const body = JSON.stringify(resp, null, 2);
  await fsp.writeFile(tmp, body, 'utf8');
  try { await fsp.rename(tmp, responsePath); }
  finally { await fsp.rm(tmp, { force: true }); }
}

/** Returns the process exit code. */
export async function runProtocol(argv: string[]): Promise<number> {
  let args: ProtocolArgs;
  try {
    args = parseProtocolArgs(argv);
  } catch (e) {
    process.stderr.write(`${TOOL_NAME}: ${e instanceof Error ? e.message : 'invalid arguments'}\n`);
    return 2;
  }
  const t0 = Date.now();
  let raw: unknown;
  try {
    const text = await fsp.readFile(args.requestPath, 'utf8');
    raw = JSON.parse(text);
  } catch (e) {
    process.stderr.write(`${TOOL_NAME}: cannot read/parse request file: ${e instanceof Error ? e.message : ''}\n`);
    return 2;
  }
  if (!isAttributableRequest(raw)) {
    process.stderr.write(`${TOOL_NAME}: request is not an attributable v1.1 invocation (kind/contractVersion/invocationId/conversionId invalid)\n`);
    return 2;
  }
  const req = raw;
  const converter = createFileConverter();
  let resp: HostInvocationResponse;
  let ws;
  try {
    ws = await converter.resolveWorkspace(req);
    // Both the request and response files must live inside the resolved workspace
    // (behavioral containment; not an OS sandbox claim).
    await assertInsideWorkspace(ws.rootReal, args.requestPath, args.responsePath);
  } catch (e) {
    if (e instanceof ToolError) {
      process.stderr.write(`${TOOL_NAME}: ${e.code} (${e.stage})\n`);
      // Reject with a non-zero protocol failure: no trusted response could be produced.
      return 1;
    }
    process.stderr.write(`${TOOL_NAME}: workspace/request-path error: ${e instanceof Error ? e.message : ''}\n`);
    return 1;
  }
  try {
    resp = await converter.runHostInvocation(req, ws);
  } catch (e) {
    // Pre-core / uncaught crash is still a non-zero protocol failure.
    if (e instanceof ToolError) resp = unattributedFailure(req, e, Date.now() - t0);
    else {
      process.stderr.write(`${TOOL_NAME}: protocol crash: ${TOOL_VERSION}\n`);
      return 1;
    }
  }
  try {
    assertSchemaValidResponse(resp);
    await writeResponseAtomic(args.responsePath, resp);
  } catch (e) {
    process.stderr.write(`${TOOL_NAME}: failed to write a valid response: ${e instanceof Error ? e.message : ''}\n`);
    return 1;
  }
  return 0;
}
