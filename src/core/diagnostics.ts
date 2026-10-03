/**
 * QA diagnostics are the LARGE, non-persistent counterpart to compact
 * provenance: engine stdout/stderr tails, full validator reports, stage
 * timing. They never enter ConvertResult (16 KiB cap); they flow only to a
 * sink wired by the QA backend / tests.
 */
export interface QaDiagnostics {
  operationId: string;
  stages: Array<{ stage: string; at: string; durationMs?: number; detail?: unknown }>;
  logs: string[];
}

export interface QaDiagnosticsSink {
  emit(d: QaDiagnostics): void;
}

export class InMemoryQaSink implements QaDiagnosticsSink {
  readonly records: QaDiagnostics[] = [];
  emit(d: QaDiagnostics): void { this.records.push(d); }
  get(operationId: string): QaDiagnostics | undefined {
    return this.records.find((r) => r.operationId === operationId);
  }
}

export interface ProvenanceSink {
  emit(json: unknown): void;
}
