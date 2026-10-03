import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/ensure-native.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Real engines (pandoc/libreoffice) run inside beforeAll/afterAll hooks;
    // under full-suite load a spawn can exceed the 10s default, so align the
    // hook budget with the contract's own engine timeout envelope.
    hookTimeout: 60_000,
    // The suite spawns real subprocess engines (pandoc) and drives heavy
    // in-process libvips work; running every file in one thread removes
    // cross-file resource contention (libvips thread pool / fd / temp) that
    // otherwise produces load-induced flake (e.g. FC_INTERNAL_ERROR in the
    // alpha-plane matrix). Production invokes one conversion per core, so this
    // only affects harness parallelism, not any quality gate.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
