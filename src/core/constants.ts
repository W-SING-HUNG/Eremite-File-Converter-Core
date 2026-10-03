/** v1.1 limits. Single source of truth. Host may tighten these per invocation. */
export const LIMITS = {
  maxSourceBytes: { office: 100 * 1024 * 1024, image: 50 * 1024 * 1024, text: 10 * 1024 * 1024 },
  /** Global streaming cap used during snapshot before real type is known. */
  maxSourceBytesGlobal: 100 * 1024 * 1024,
  archive: {
    maxExpandedBytes: 500 * 1024 * 1024,
    maxEntryBytes: 200 * 1024 * 1024,
    maxEntries: 10_000,
    maxCompressionRatio: 100,
  },
  imagePixels: { maxMegapixels: 100, maxEdge: 30_000 },
  /** Decoded raster / in-memory output buffer resource caps (Host-tightenable). */
  imageMemory: { maxDecodedPixels: 100_000_000, maxOutputBufferBytes: 512 * 1024 * 1024 },
  timeoutMs: {
    libreoffice: 180_000,
    pandoc: 60_000,
    sharp: 60_000,
    hardCap: 600_000,
  },
  capturedOutputBytes: 1024 * 1024,
  /** At most one LibreOffice conversion per Core instance at a time. */
  concurrency: { libreoffice: 1, globalInvocations: 2 },
  compactResultMaxSerializedBytes: 16 * 1024,
  compactWarningsKept: 30,
} as const;

export const TOOL_NAME = 'file-converter-core';
export const TOOL_VERSION = '1.1.2';
export const PROTOCOL_MAJOR = 1;
export const CONTRACT_SCHEMA_VERSION = '1.1';
