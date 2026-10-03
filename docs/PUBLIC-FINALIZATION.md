# Current public state

This [public source repository](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core) provides version **1.1.2**.
The [source tag](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core/tree/v1.1.2) identifies the source tree.
No npm package has been published; `private: true` prevents accidental npm
publication and does not describe repository visibility.

## Supported baseline

Node.js >=24 <25; Windows is the formal production lane. Install Pandoc >=3.1 and LibreOffice >=7.6 for their conversions, and the .NET Framework v4 C# compiler to build the Windows helper.

Host owns UI, policy, authorization, workspace isolation, routing, validation,
persistence, File Lifecycle and Run History. Supplier Core only provides
headless capability. See the [README](../README.md) for capabilities and protocol.

## Source and runtime archives

Eremite Host vendors a separately packaged, fixed Supplier runtime archive.
The source tag is not a runtime tgz. A local rebuild creates a new artifact;
it does not replace the Host archive or establish matching bytes.
Source documentation updates do not update the fixed archive.

Sharp and its native dependencies are obtained by the consumer through npm.
Pandoc and LibreOffice are external executables, not bundled.

## Security, support and license

GitHub Private Vulnerability Reporting is enabled. Use this repository's
[private reporting page](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core/security/advisories/new)
for vulnerabilities; ordinary bugs and usage questions go to GitHub Issues.

See [SECURITY.md](../SECURITY.md), [SUPPORT.md](../SUPPORT.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md). No response or resolution time is promised.

Supplier-owned source is [Apache-2.0](../LICENSE).
Copyright 2026 翁成航 (Chenghang Weng). Attribution is in [NOTICE](../NOTICE);
third-party components retain their own licenses and notices.
