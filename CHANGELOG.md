# Changelog

All notable changes to the Kinana project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.5] - 2026-11-10

### Changed
- Removed redundant optional labels (`(اختياري)`, `- اختياري`, `اختياري`) across account, payment card, and service forms while retaining contextual guidance hints (`اتركه فارغاً للإبقاء...`).
- Added consistent, accessible red required asterisks (`*` with screen-reader `(مطلوب)` semantics and `aria-required` bindings via shared `<FormLabel />`) exclusively on genuinely required form fields across vault creation, unlock, service management, new card number, password change, auto-unlock, emergency recovery, and import dialogs.

### Fixed
- Fixed Linux Mint WebKitGTK Arabic placeholder glyph corruption inside password-masked fields (where `"اتركه فارغاً..."` combining marks could trigger shadow-placeholder vertical offset clipping) by rendering an accessible HTML placeholder layer in `<SecretInput />` with normal RTL line layout and explicit `unicode-bidi: plaintext` / `-webkit-text-security: none` rules in `index.css`.
- Fixed Arabic descender/glyph clipping and tight padding across `<Input />` and `<SecretInput />` by removing desktop `md:text-sm` overrides, increasing default line height (`leading-[1.65]` / `1.7`) and horizontal clearance (`px-4`, `rtl:pl-14`/`rtl:pl-16` around toggle icons, `pr-9 pl-8` on search inputs), and fixing LTR text flow for Email, URL (`https://...`), and Card Expiry inputs.

---

## [0.1.4] - 2026-11-10

### Changed
- Application Emergency Recovery Key in Settings is now masked by default behind an eye reveal/hide toggle and supports reveal-free copying through a dedicated backend IPC command (`copy_vault_recovery_key`), clearing temporary UI reveal state upon locking or closing Settings.

### Fixed
- Mitigated intermittent black rectangular rendering artifacts on Linux WebKitGTK by defaulting `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` when unset (stripped before spawning host processes), removing `blur-3xl` GPU filter layers and nested `backdrop-blur` surfaces inside the Service Detail modal, and flattening redundant inner scroll containers.
- Audited Debian `.deb` archive metadata (`control.tar.gz` verified scriptless with `Package: kinana` and clean `.desktop` entry) and removed redundant empty configuration overrides in `tauri.linux.conf.json`, isolating the post-install unresponsive close button on Linux Mint to upstream graphical installer (`gdebi-gtk`) behavior.
- Normalized form control and placeholder `letter-spacing` alongside cross-platform Arabic font fallbacks (`Noto Sans Arabic`, `Segoe UI`, `SF Arabic`, `Tahoma`) and `<bdi dir="ltr">` mixed-direction isolation, preventing disjointed or stretched Arabic labels and reversed `.dat` extensions.
- Replaced non-standard CSS `zoom` with coordinated container-width expansion, CSS grid track scaling, container-query service card scaling, and list view scaling so text no longer clips inside cards at high zoom levels (e.g., 200%).
- Unified secret input fields under a shared `<SecretInput />` component (`top-1/2 -translate-y-1/2`, RTL/LTR logical toggle placement, valid `h-12`/`h-16` heights, and code styling applied only when filled), resolving misaligned or sunken eye buttons in Bank Card, Auto-Unlock, Recovery, Import, and Settings dialogs.
- Updated shared RTL dialog headers (`text-start pe-8`), descriptions, titles, and footer gaps to prevent left-aligned wrapping on secondary lines.

---

## [0.1.3] - 2026-11-10

### Added
- Optional Linux Auto-Unlock integration backed by Freedesktop Secret Service (GNOME Keyring / KWallet via D-Bus).
- Linux-specific desktop launcher template (`desktop.template`) supporting localized Arabic application title (`Name[ar]=كنانة`).
- Automated Debian package metadata inspection and apt installation smoke testing in CI and release workflows.

### Fixed
- Fixed Debian package metadata on Linux: decoupled Debian control package name (`kinana`) from Arabic application branding (`كنانة`), eliminating package manager rejection (`invalid package name in 'Package' field`).
- Fixed file manager launching from AppImage environments: sanitized host environment variables (`LD_LIBRARY_PATH`, `LD_PRELOAD`, GTK/GIO module paths) before spawning host tools, eliminating Nemo/GLib symbol crashes and preventing directory listings in browsers.
- Fixed bulk delete dialog title and trash icon alignment in RTL layouts, and repositioned the dialog close button to prevent header collision.
- Updated bulk delete confirmation button text to accurately reflect the selected item count rather than generic delete-all wording.
- Fixed vault import success notification styling, replacing incorrect error styling with distinct success/warning banners and adding overflow wrapping to prevent horizontal layout overflow.

---

## [0.1.2] - 2026-11-10

### Added
- Cross-platform desktop support:
  - macOS Apple Silicon (arm64 `.dmg`).
  - macOS Intel (x86_64 `.dmg`).
  - Linux Debian/Ubuntu (x86_64 `.deb`).
  - Linux universal standalone (x86_64 `.AppImage`).
- Predictable, permanent download filenames across GitHub Releases (`kinana-windows-x64-setup.exe`, `kinana-macos-arm64.dmg`, `kinana-macos-x64.dmg`, `kinana-linux-x64.deb`, `kinana-linux-x64.AppImage`, and `SHA256SUMS.txt`).
- Complete documentation suite in `docs/` (`installation.md`, `getting-started.md`, `security.md`, `faq.md`, `benchmarks.md`).
- Community standard guidelines: `CONTRIBUTING.md`, `SECURITY.md`, and structured GitHub issue templates.
- Arabic README (`README.ar.md`) alongside bilingual language switcher in repository root.
- Automated `cargo-audit` step in the continuous integration workflow.

### Fixed
- Replaced retired `macos-13` runner in release packaging workflow with `macos-15-intel`.
- Resolved npm high/moderate dependency vulnerabilities across frontend build tooling.
- Synchronized version declarations across Rust crates, Tauri configuration, and npm manifests.

---

## [0.1.1] - 2026-10-29

### Added
- Automatic Win32 working set trimming: flushes unused physical memory pages when minimized or locked, reducing idle RAM consumption to approximately 42 MB.
- High-efficiency WOFF2 font compression for default typography, reducing asset footprint by over 85%.
- Dynamic asynchronous lazy-loading for the 128-cover service catalog, reducing primary JavaScript bundle size from 1.25 MB to 448 KB.
- Atomic write-ahead transaction journal (`.journal`) with rollback safety copies (`.vbak`, `.rbak`) to prevent corruption during unexpected shutdowns.

### Security
- Windows Credential Manager auto-unlock hardening with bounded lifetime guards.
- Memory zeroization enforcement across all sensitive credential state and derived cryptographic keys.

---

## [0.1.0] - 2026-10-18

### Added
- Initial public release of Kinana for Windows 10 and 11.
- AES-256-GCM symmetric authenticated encryption.
- Argon2id key derivation with high-security desktop parameters.
- Master password protection and Emergency Recovery Key generation.
- Service accounts and banking payment cards management.
- Dual view modes: Poster Grid and List View.
- Configurable auto-lock inactivity timer.
- Encrypted file backup export and import (`.dat`).
- Native Arabic user interface with RTL layout support.
