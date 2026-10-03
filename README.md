# File Converter Core

File Converter Core is a headless conversion capability for an integrating Host. This source-first project is version **1.1.2**; npm publication is a separate process. Its production interface is Canonical Contract v1.1 in [`tool-contract.json`](tool-contract.json), a JSON Schema Draft 2020-12 document. The contract and established 18 technical conversion pairs are unchanged from the internally accepted 1.1.1 build.

The Eremite Host owns capability policy, authorization, workspace selection, UI, database, File Lifecycle, and Run History. The Supplier validates and executes one Host-requested conversion inside the supplied workspace. Its technical registry is not a Host allowlist. It does not choose additional conversions or publish outputs to a user's library.

## Supported environment

- Node.js 24 (`engines.node: >=24 <25`) and npm compatible with the committed lockfile. Windows is the formal production lane. Node 26 and other platforms are not covered by the supported release gate.
- `sharp@0.35.4` is the only direct runtime npm dependency. npm installs its applicable native package for the consumer platform. It is not embedded in this package tarball.
- Pandoc 3.1 or newer is an optional external executable for Markdown/HTML/DOCX conversions. The engine uses `--sandbox`.
- LibreOffice 7.6 or newer is an optional external executable for DOCX/XLSX/PPTX to PDF. The engine starts a separate headless process with an isolated profile. Neither executable is bundled.
- On Windows, building `fc-movefile.exe` requires the .NET Framework v4 C# compiler at `%WINDIR%\Microsoft.NET\Framework64\v4*\csc.exe`. [`tools/build-native.mjs`](tools/build-native.mjs) discovers it and compiles [`FcMoveFile.cs`](src/native/win32/FcMoveFile.cs). The helper is shipped in `dist/native/bin` after a Windows build; the compiler is not shipped.

If an optional external engine is missing, its conversions fail with `FC_DEPENDENCY_MISSING`; the Supplier does not silently fall back. See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for distribution categories and the approved Supplier tgz + consumer npm dependency distribution scope.

## Production protocol

```text
file-converter-core --protocol 1 --request <absolute-request.json> --response <absolute-response.json>
```

The Host supplies a UUID `invocationId`, source digest and size, `conversionId`, a single `enginePlan`, target, limits, and absolute paths in its owned workspace. The Supplier rechecks source identity, confines paths and output, and writes a schema-valid response. Exit 0 means a response was written, whether the conversion succeeded or failed; nonzero means a trusted response could not be produced. The canonical schema defines the exact request and response fields, error and warning codes, and stages.

The 18 conversion pairs are 12 image pairs among PNG/JPEG/WebP/AVIF through Sharp, Markdown to HTML, HTML to Markdown, Markdown to DOCX through Pandoc, and DOCX/XLSX/PPTX to PDF through LibreOffice. The Host decides which, if any, are available to a user.

## Build, test, and package

Run from the source-tree root with Node 24:

```powershell
npm ci
npm run typecheck
npm run build
npm test
npm audit
npm audit --omit=dev
npm pack --dry-run --json
npm pack
```

`npm run build` cleans `dist`, builds the Windows no-replace native helper, then compiles production TypeScript. `npm run build:native` builds only the helper. `dist` is generated output; do not edit it by hand. On non-Windows systems the native script skips the executable and uses a portable development lane, which is not the formal Windows release lane.

The full test suite generates fixtures in temporary directories and uses real installed engines when available. A missing external engine or unavailable symlink privilege can cause explicit skips; inspect the test report before treating a run as complete. `dev-harness/` and `src/dev/` are source-only development surfaces excluded from the production build and npm package.

This is the rebuildable source-first tree for version 1.1.2. The `.tgz` is a runtime package containing compiled `dist`, contract, README, license, notices, and metadata. `private: true` prevents accidental npm publication. Canonical source is recorded below; the product owner has finalized copyright attribution in NOTICE. Source version identity does not assert a GitHub Release. Rebuild and revalidate the local package after metadata is finalized.

## Security and licensing

The Supplier invokes external programs with argument arrays, limits execution to the Host-owned workspace, rechecks source bytes, rejects unsafe paths and unsupported input, validates output before fixed-path no-replace publish, and keeps raw engine diagnostics out of public responses. The Host must still enforce its own policy and validate results at its trust boundary.

Supplier Core is licensed under Apache-2.0; see [`LICENSE`](LICENSE). Third-party software retains its own licenses. Copyright 2026 翁成航 (Chenghang Weng). See [NOTICE](NOTICE). Sharp/libvips is VERIFIED FOR PUBLIC DISTRIBUTION for Supplier tgz + consumer obtains dependencies from npm, as confirmed by the product owner. Source-first delivery does not imply npm publication.

## Source repository and finalization

Canonical source repository: https://github.com/W-SING-HUNG/Eremite-File-Converter-Core. Source-first version: 1.1.2.

Owner attribution is finalized in [NOTICE](NOTICE) and the existing licensing paragraph.
Keep the standard Apache LICENSE text unchanged. Upstream third-party copyright
notices are retained and must not be replaced with the Supplier holder.

See [finalization checklist](docs/PUBLIC-FINALIZATION.md) and [security policy](SECURITY.md).
