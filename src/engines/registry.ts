import type { EngineInfo } from '../core/types.js';
import type { ConversionPair, Engine } from './base.js';
import { isLegalPair } from './base.js';
import { conversionIdFor } from '../core/technical-support.js';

export class EngineRegistry {
  private readonly engines: Engine[];

  constructor(engines: Engine[] = []) {
    this.engines = engines;
  }

  list(): Engine[] {
    return [...this.engines];
  }

  byId(id: string): Engine | undefined {
    return this.engines.find((e) => e.id === id);
  }

  async describe(): Promise<EngineInfo[]> {
    return Promise.all(
      this.engines.map(async (e) => ({
        id: e.id,
        type: e.type,
        found: await e.available(),
        version: await e.version(),
        executablePath: null,
        provides: e.provides().map((p) => conversionIdFor(p.from, p.to)),
        optional: e.optional,
      })),
    );
  }

  /**
   * v1.1: exactly ONE accepted engine per conversionId — no silent substitution
   * and no runtime fallback. Returns the engine only if it exists, declares the
   * pair, and is currently available.
   */
  async resolveExact(engineId: string, pair: ConversionPair): Promise<{ engine: Engine; version: string | null } | { engine: null }> {
    if (!isLegalPair(pair.from, pair.to)) return { engine: null };
    const e = this.byId(engineId);
    if (!e) return { engine: null };
    if (!e.provides().some((p) => p.from === pair.from && p.to === pair.to)) return { engine: null };
    if (!(await e.available())) return { engine: null };
    return { engine: e, version: await e.version() };
  }

  /**
   * DEV ONLY engine picker for the QA CLI/backend: prefer the accepted engine,
   * but fall back to ANY registered available engine that provides the pair
   * (so the QA stub can exercise the pipeline). Production always uses
   * resolveExact with the Host-designated engine.
   */
  async resolveDev(pair: ConversionPair, preferredId: string | undefined): Promise<{ engine: Engine; version: string | null } | { engine: null }> {
    if (!isLegalPair(pair.from, pair.to)) return { engine: null };
    const ordered = preferredId
      ? [this.byId(preferredId), ...this.engines.filter((e) => e.id !== preferredId)]
      : this.engines;
    for (const e of ordered) {
      if (!e) continue;
      if (!e.provides().some((p) => p.from === pair.from && p.to === pair.to)) continue;
      if (await e.available()) return { engine: e, version: await e.version() };
    }
    return { engine: null };
  }

  /** Environment report only — never widens accepted capability. */
  async availablePairs(): Promise<Array<{ from: ConversionPair['from']; to: ConversionPair['to']; engine: string }>> {
    const out: Array<{ from: ConversionPair['from']; to: ConversionPair['to']; engine: string }> = [];
    for (const e of this.engines) {
      if (!(await e.available())) continue;
      for (const p of e.provides()) out.push({ ...p, engine: e.id });
    }
    return out;
  }
}
