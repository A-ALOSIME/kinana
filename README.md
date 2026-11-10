<div align="center">

<img src="assets/logo.png" alt="Kinana Logo" width="128" height="128" />

# Kinana

**Offline-First Desktop Password Manager**

Built with Rust, Tauri 2, and React.

[![GitHub Release](https://img.shields.io/github/v/release/A-ALOSIME/kinana?style=flat-square)](https://github.com/A-ALOSIME/kinana/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/A-ALOSIME/kinana/ci.yml?branch=main&style=flat-square)](https://github.com/A-ALOSIME/kinana/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[English](README.md) | [العربية](README.ar.md)

</div>

---

Kinana is a fast, offline-first desktop password manager engineered for privacy and security. It encrypts all credentials locally on your computer with AES-256-GCM and Argon2id. Kinana contains zero cloud dependencies, zero network tracking, and zero external telemetry.

---

## Downloads

Download the latest version for your platform:

| Platform | Architecture | Package Format | Download | Status |
|---|---|---|---|---|
| **Windows** | x86_64 (64-bit) | NSIS Setup (`.exe`) | [kinana-windows-x64-setup.exe](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe) | Stable |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | Disk Image (`.dmg`) | [kinana-macos-arm64.dmg](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) | Preview |
| **macOS** | Intel (x86_64) | Disk Image (`.dmg`) | [kinana-macos-x64.dmg](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg) | Preview |
| **Linux** | x86_64 | Debian / Ubuntu (`.deb`) | [kinana-linux-x64.deb](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.deb) | Preview |
| **Linux** | x86_64 | Universal (`.AppImage`) | [kinana-linux-x64.AppImage](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.AppImage) | Preview |

To verify the integrity of downloaded files, check them against the official checksums:
[SHA256SUMS.txt](https://github.com/A-ALOSIME/kinana/releases/latest/download/SHA256SUMS.txt)

> Note: macOS and Linux distributions are currently marked as Preview releases. For detailed setup steps, including Windows SmartScreen and macOS Gatekeeper guidelines, see the [Installation Guide](docs/installation.md).

---

## Key Features

- **100% Offline Architecture**: No cloud servers, no remote databases, and no outbound network calls. Your credentials remain on your device.
- **Strong Cryptography**: Vault payloads are protected with AES-256-GCM authenticated encryption and key derivation powered by Argon2id (64 MiB memory, 3 iterations, 4 threads).
- **Emergency Recovery Key**: Generate an offline cryptographic recovery key during vault setup to regain access if you forget your master password.
- **Arabic-First Interface**: Purpose-designed modern dark interface supporting RTL Arabic typography with Thmanyah Sans, as well as English.
- **Accounts and Payment Cards**: Manage website credentials, usernames, notes, and payment cards (Mada, Visa, Mastercard) with specialized masked fields.
- **Auto-Lock on Inactivity**: Automatically lock your vault after a customizable idle duration. The timer intelligently suspends while actively typing in form fields to prevent data loss.
- **Crash-Safe Transaction Journal**: Atomic write-ahead journal safeguards your vault data from corruption during sudden power outages or system crashes.
- **Resource Efficient**: Native Rust core paired with automated working set trimming reduces background memory footprint to approximately 42 MB.
- **Encrypted Export & Import**: Create encrypted portable `.dat` backups to transfer your vault securely between devices using your master password.

---

## Quick Installation Overview

### Windows
1. Download [kinana-windows-x64-setup.exe](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe).
2. Run the installer. If Windows SmartScreen displays a warning, click **More info** then **Run anyway** (Kinana is an independent open-source project without a commercial EV certificate).
3. Follow the setup wizard to complete installation.

### macOS (Preview)
1. Download the `.dmg` matching your processor architecture ([Apple Silicon](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) or [Intel](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg)).
2. Open the disk image and drag **Kinana** into your **Applications** folder.
3. On first launch, right-click **Kinana** in Finder and choose **Open**, or run:
   ```bash
   xattr -cr /Applications/Kinana.app
   ```

### Linux (Preview)
- **Debian / Ubuntu**:
  ```bash
  sudo apt install ./kinana-linux-x64.deb
  ```
- **Universal AppImage**:
  ```bash
  chmod +x kinana-linux-x64.AppImage
  ./kinana-linux-x64.AppImage
  ```

For complete instructions, see [docs/installation.md](docs/installation.md).

---

## Documentation

- [Installation Guide](docs/installation.md) - Platform-specific installation and troubleshooting.
- [Getting Started](docs/getting-started.md) - First-time setup, adding accounts, and recovery keys.
- [Security Architecture](docs/security.md) - Cryptographic primitives, binary vault format, and threat model.
- [Frequently Asked Questions (FAQ)](docs/faq.md) - Common operational and security inquiries.
- [Performance & Benchmarks](docs/benchmarks.md) - Measured memory utilization and bundle optimizations.
- [Changelog](CHANGELOG.md) - Version history and release notes.

---

## Building from Source

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) (version 18 or later) with `npm`
- Platform C++ build tools (Visual Studio Build Tools on Windows, Xcode CLI on macOS, or `build-essential` on Linux)

### Build Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/A-ALOSIME/kinana.git
   cd kinana
   ```

2. Install frontend dependencies:
   ```bash
   cd ui
   npm install
   cd ..
   ```

3. Run in development mode:
   ```bash
   npm --prefix ui run dev
   ```

4. Build production bundle:
   ```bash
   npm --prefix ui run build
   cargo tauri build
   ```

---

## Security

Security vulnerabilities should be reported confidentially following the instructions in [SECURITY.md](SECURITY.md). Please do not report security issues via public GitHub issues.

---

## Contributing

Contributions, bug reports, and suggestions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

This project is licensed under the [MIT License](LICENSE).
