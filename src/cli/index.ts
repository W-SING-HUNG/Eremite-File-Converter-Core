#!/usr/bin/env node
/**
 * file-converter-core CLI — PRODUCTION ONLY.
 *
 *   file-converter-core --protocol 1 --request <abs.json> --response <abs.json>
 *
 * exit 0 = a schema-valid response was written (succeeded OR business-failed);
 * non-zero = protocol/crash failure (no trusted response produced).
 *
 * DEV/QA helpers (in-process detect / capabilities / convert) are NOT available
 * from this binary; they live in src/dev/api.ts for the QA backend / tests.
 */
import { parseArgs } from 'node:util';
import { createFileConverter, ToolError } from '../index.js';
import { runtimeSupported, unsupportedRuntimeMessage } from '../core/runtime-guard.js';
import { runProtocol } from '../protocol/run-protocol.js';

if (!runtimeSupported()) {
  process.stderr.write(unsupportedRuntimeMessage('file-converter-core') + '\n');
  process.exit(1);
}

async function printUsage(): Promise<number> {
  process.stdout.write(
    'file-converter-core v1.1 (Host Contract v1.1)\n\n' +
    'Production protocol:\n' +
    '  file-converter-core --protocol 1 --request <abs.json> --response <abs.json>\n',
  );
  return 0;
}

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
  printUsage().then((code) => { process.exitCode = code; }).catch(() => { process.exit(1); });
} else {
  const entry = argv[0] === '--protocol' ? runProtocol(argv) : (async () => {
    process.stderr.write('unknown command; use --protocol 1 --request <abs.json> --response <abs.json>\n');
    return 2;
  })();
  entry.then((code) => {
    process.exitCode = code;
  }).catch((e: unknown) => {
    const err = e instanceof ToolError ? e.toJSON() : { code: 'FC_INTERNAL_ERROR', stage: 'internal', retryable: false } as const;
    process.stderr.write(JSON.stringify(err, null, 2) + '\n');
    process.exit(1);
  });
}
