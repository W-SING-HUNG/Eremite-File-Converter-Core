/**
 * Runtime baseline guard: v1 production runtime is Node 24 LTS (engines
 * `>=24 <25`). Node <24 is rejected with a clear message instead of cryptic
 * downstream failures. Node 26 may run only as an optional compatibility lane.
 */
export function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0]);
}

export function runtimeSupported(): boolean {
  const major = nodeMajor();
  return Number.isFinite(major) && major >= 24;
}

export function unsupportedRuntimeMessage(where = 'file-converter-core'): string {
  return `${where} requires Node 24 LTS, but the active runtime is Node ${process.versions.node}. ` +
    `Start it with a Node 24 interpreter (package engines: >=24 <25).`;
}

/** Throws a clean Error (no stack-facing CLI output) when the runtime is below baseline. */
export function assertSupportedRuntime(where: string = 'file-converter-core'): void {
  if (!runtimeSupported()) throw new Error(unsupportedRuntimeMessage(where));
}
