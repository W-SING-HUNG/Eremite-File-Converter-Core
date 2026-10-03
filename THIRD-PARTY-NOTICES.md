# Third-party distribution inventory (1.1.2 source-first)

This inventory distinguishes what the File Converter Core tarball contains from software installed or supplied separately. License identifiers come from the committed npm lockfile and locally inspected Windows x64 dependency packages. They do not relicense third-party work. The Supplier tarball and the npm-installed dependency closure are separate distribution categories.

| Component | Category | License / evidence | Distribution note |
| --- | --- | --- | --- |
| Supplier TypeScript output and `fc-movefile.exe` | BUNDLED | Supplier Apache-2.0, `LICENSE` | The helper is compiled from `src/native/win32/FcMoveFile.cs`; its source and build script are in the source tree. |
| `sharp@0.35.4` | NPM INSTALLED | Apache-2.0, package metadata and `sharp/LICENSE` | Direct runtime dependency. npm installs it after unpacking the Supplier tarball. |
| `@img/sharp-win32-x64@0.35.4` | NPM INSTALLED, platform optional | `Apache-2.0 AND LGPL-3.0-or-later`, package metadata | Windows x64 native binary. Its README lists bundled native libraries, including libvips and several LGPL components. Its LICENSE and README remain in the installed dependency. |
| Other `@img/sharp-*` optional platforms | NPM INSTALLED when applicable | Lockfile package metadata varies by platform | The lockfile includes Linux, macOS, FreeBSD/WASM and Windows variants. Review each installed platform's notices before distribution. |
| `@img/sharp-libvips-* @1.3.3` | NPM INSTALLED when applicable | LGPL-3.0-or-later, lockfile metadata | Platform-specific libvips packages; none are embedded in the Supplier tarball. |
| `@img/colour@1.1.0`, `@emnapi/runtime@1.11.3`, `detect-libc@2.1.2`, `semver@7.8.5`, `tslib@2.8.1` | NPM INSTALLED as resolved by platform | MIT, MIT, Apache-2.0, ISC, 0BSD respectively, lockfile metadata | Transitive runtime/optional closure. Consult each installed package's license text. |
| Node.js runtime | EXTERNAL PREREQUISITE | Node.js distribution terms | Required to run the package; not embedded in the tarball. |
| .NET Framework v4 `csc.exe` and Microsoft build libraries | BUILD-TIME ONLY | Microsoft distribution terms | Used to compile the Windows helper. Compiler and Framework are not bundled. |
| TypeScript, Vitest, Vite, tsx, React and their dependencies | BUILD-TIME ONLY | `package-lock.json` and installed package licenses | Development dependency closure; not bundled in the runtime tarball. |
| Pandoc | EXTERNAL PREREQUISITE | Installed Pandoc distribution terms | Optional separately installed executable. No Pandoc files are bundled. |
| LibreOffice | EXTERNAL PREREQUISITE | Installed LibreOffice distribution terms | Optional separately installed executable. No LibreOffice files are bundled. |

The published Windows x64 `@img/sharp-win32-x64` README is the immediate source for its native-library list: aom, cairo, cgif, expat, fontconfig, freetype, fribidi, glib, harfbuzz, highway, lcms, libarchive, libexif, libffi, libheif, libimagequant, libnsgif, libpng, librsvg, libtiff, libultrahdr, libvips, libwebp, libxml2, mozjpeg, pango, pixman, proxy-libintl, and zlib-ng. Several use LGPL, MPL, or other non-Apache licenses. Installed dependencies retain their own licenses and notices. The Supplier tarball itself contains no `node_modules` or these native libraries; a consumer obtains them through npm.
