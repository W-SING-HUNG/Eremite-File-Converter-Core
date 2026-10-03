# Eremite File Converter Core

A local, headless file-conversion capability for an integrating Host.
Current source version: **1.1.2**. It implements **Canonical Contract v1.1**
in [tool-contract.json](tool-contract.json), a JSON Schema Draft 2020-12 document.

The Supplier validates and executes one Host-requested conversion inside the
supplied workspace. It provides no application UI, database persistence,
user-library management or autonomous execution.

## Supported environment and prerequisites

- Node.js **>=24 <25**. Windows is the formal production lane; other platforms
  and Node.js major versions are outside the supported production baseline.
- **sharp 0.35.4** is the direct runtime npm dependency. npm installs its
  applicable native platform package; Sharp and libvips are not embedded in
  the Supplier runtime tarball.
- External **Pandoc >=3.1** for supported Markdown/HTML/DOCX conversions.
  The engine uses `--sandbox`.
- External **LibreOffice >=7.6** for DOCX/XLSX/PPTX → PDF, running headlessly
  with an isolated profile.
- Pandoc and LibreOffice are optional, user-installed executables and are
  not bundled. Make them accessible on the Host process PATH.
- Building the Windows `fc-movefile.exe` helper requires the .NET Framework v4
  C# compiler under `%WINDIR%\Microsoft.NET\Framework64\v4*\csc.exe`.
  [tools/build-native.mjs](tools/build-native.mjs) discovers the compiler and
  builds [FcMoveFile.cs](src/native/win32/FcMoveFile.cs). The compiler is not shipped.

A missing optional engine fails its conversions with `FC_DEPENDENCY_MISSING`;
there is no silent fallback. See [third-party notices](THIRD-PARTY-NOTICES.md)
for bundled components, npm-installed dependencies and external prerequisites.

## Capabilities

The technical registry defines **18 conversion pairs**:

| Engine | Conversions | Count |
| --- | --- | --- |
| Sharp | PNG, JPEG, WebP and AVIF to each of the other three formats | 12 |
| Pandoc | Markdown → HTML, HTML → Markdown, Markdown → DOCX | 3 |
| LibreOffice | DOCX → PDF, XLSX → PDF, PPTX → PDF | 3 |

The Host owns the allowlist and policy. **The Supplier technical registry is
not Host authorization.** The Host decides which conversions are available
to users and validates all results before persistence.

## Protocol / contract

```text
file-converter-core --protocol 1 --request <absolute-request.json> --response <absolute-response.json>
```

The Host supplies a UUID `invocationId`, source digest and size, `conversionId`,
one `enginePlan`, target, limits and absolute paths in its owned workspace.
The Supplier rechecks source identity, confines paths and output, and writes
a schema-valid response. Consult the canonical contract for exact request,
response, error, warning and stage definitions.

Exit `0` means a response was written, whether the conversion succeeded or
failed. A nonzero exit means a trusted response could not be produced.

## Build and test

From the source root with Node.js 24 and the Windows build prerequisite above:

```powershell
git clone https://github.com/W-SING-HUNG/Eremite-File-Converter-Core.git
cd Eremite-File-Converter-Core
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

Build cleans `dist/`, compiles the Windows no-replace helper, then compiles
production TypeScript. `npm.cmd run build:native` builds only the helper.
Generated `dist/` files should not be edited manually. On other platforms,
the native script skips the executable and uses a portable development path;
this does not establish production platform support.

Tests use synthetic fixtures in temporary directories and real external engines
when available. Missing engines or symlink privilege can cause explicit skips;
inspect the report. `dev-harness/` and `src/dev/` are source-only development
surfaces excluded from the production build and runtime package.

## Host / Supplier boundary

Host owns UI, policy, authorization, workspace isolation, routing, validation,
persistence, File Lifecycle and Run History. Supplier Core only provides
headless capability for the bounded request. It neither chooses extra operations
nor publishes outputs into a user's library.

The Supplier uses argument arrays for external processes, rechecks immutable
input identity, rejects unsafe paths and unsupported input, validates output
before fixed-path no-replace publication, and excludes raw engine diagnostics
from public responses. Host validation remains required at its own trust boundary.

## Distribution

This [public source repository](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core)
and its [v1.1.2 source tag](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core/tree/v1.1.2)
contain rebuildable source, tests and contract definitions.

Eremite Host uses a separately packaged, fixed runtime archive under
`vendor/file-converter/`. It contains compiled `dist/`, the contract, metadata,
README and license/notices. A source tag or a local rebuild does not identify
that Host-vendored artifact by bytes. Source documentation can differ from
documentation embedded in the fixed archive.

For packaging development, `npm.cmd pack --dry-run --json` inspects the file
list after building; `npm.cmd pack` creates a new local archive. A new archive
does not replace the Host artifact automatically. No npm package has been
published; `private: true` guards against accidental npm publication.

## Contributing, support and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and contract compatibility,
and [SUPPORT.md](SUPPORT.md) for capability bugs versus Host integration questions.

Report vulnerabilities through this repository's
[Private Vulnerability Reporting](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core/security/advisories/new),
following [SECURITY.md](SECURITY.md). Do not disclose sensitive details in public Issues.

## License

Supplier-owned code is [Apache-2.0](LICENSE). Third-party software retains its own
licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Copyright 2026 翁成航 (Chenghang Weng). See [NOTICE](NOTICE) and the
[current public state](docs/PUBLIC-FINALIZATION.md).
