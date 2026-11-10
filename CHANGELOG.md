# Changelog

All notable changes to the Kinana project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
