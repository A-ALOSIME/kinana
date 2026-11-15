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

Kinana is a fast, offline-first desktop password manager engineered for privacy and local data sovereignty. It encrypts credentials, payment cards, and sensitive notes directly on your workstation using authenticated AES-256-GCM encryption and Argon2id key derivation.

With zero cloud dependencies, zero network tracking, and zero external telemetry, your data and encryption keys never leave your device.

---

## Downloads

Download the latest release for your operating system:

| Platform | Architecture | Package Format | Download | Status |
|---|---|---|---|---|
| **Windows** | x86_64 (64-bit) | NSIS Setup (`.exe`) | [kinana-windows-x64-setup.exe](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe) | Stable |
| **Linux** | x86_64 | Debian / Ubuntu (`.deb`) | [kinana-linux-x64.deb](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.deb) | Stable |
| **Linux** | x86_64 | Universal (`.AppImage`) | [kinana-linux-x64.AppImage](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.AppImage) | Stable |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | Disk Image (`.dmg`) | [kinana-macos-arm64.dmg](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) | Preview |
| **macOS** | Intel (x86_64) | Disk Image (`.dmg`) | [kinana-macos-x64.dmg](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg) | Preview |

To verify the integrity and authenticity of downloaded files, check them against the official checksums:
[SHA256SUMS.txt](https://github.com/A-ALOSIME/kinana/releases/latest/download/SHA256SUMS.txt)

> Note: Linux packages (DEB and AppImage) are marked as Stable based on development and test distribution verification; compatibility is not claimed across every Linux distribution or hardware configuration. macOS builds remain in Preview pending comprehensive manual hardware testing. For detailed setup steps, including Windows SmartScreen and macOS Gatekeeper guidelines, see the [Installation Guide](docs/installation.md).

---

## Key Features

- **100% Offline Vault Storage**: No cloud servers, no remote databases, and no outbound network calls. All credentials and encryption keys remain on your computer.
- **Robust Cryptography**: Authenticated AES-256-GCM symmetric encryption with Additional Authenticated Data (AAD) protection and high-iteration Argon2id key derivation (64 MiB memory, 3 iterations, 4 threads).
- **Multilingual Support (22 Languages)**: Full native localization across 22 languages with dedicated Right-to-Left (RTL) support for Arabic, Persian, Hebrew, and Urdu alongside comprehensive LTR scripts.
- **Service Accounts and Payment Cards**: Manage login credentials, usernames, account recovery keys (2FA recovery codes), payment cards (Mada, Visa, Mastercard, AMEX), CVV codes, card PINs, and secure notes.
- **Password Generator & Independent Secret Controls**: Built-in cryptographic password generator with customizable length and character sets. Dedicated, independent Copy and Eye (reveal/hide) controls for all passwords, PINs, and CVV fields.
- **Configurable Auto-Lock**: Automatically lock the vault after a customizable inactivity timeout (1, 5, 10, 15, 30, 60 minutes, or a custom duration). The timer automatically suspends while actively typing in form fields to prevent data loss.
- **Optional Native Auto-Unlock**: Convenient opt-in desktop integration using Windows Credential Manager (`wincred`) or Linux Secret Service (`org.freedesktop.secrets`). (Auto-Unlock is currently disabled on macOS pending native Keychain verification).
- **Crash-Safe Transaction Journal**: Atomic write-ahead transaction journal (`.journal`) with automatic rollback safety backups (`.vbak`, `.rbak`) safeguards against vault corruption during sudden system crashes or power outages.
- **Emergency Recovery Key & Vault Reset**: Generate an offline cryptographic recovery key during vault creation. If both the master password and recovery key are lost, the **Start a New Vault** flow permits safely purging orphaned local vault data to begin anew.
- **Encrypted Export & Import**: Create portable encrypted `.dat` backups using your master password to transfer your vault securely between devices without network exposure.
- **Resource Efficient**: Lightweight native Rust core paired with automated working-set memory trimming on Windows that flushes inactive physical memory pages when minimized or locked, dropping the measured background working set to approximately 42 MB (active foreground usage varies with UI rendering and GPU composition; see [docs/benchmarks.md](docs/benchmarks.md)).
- **Free & Open Source**: Licensed under the permissive MIT License for complete auditability and community trust.

---

## Privacy and Security Overview

Kinana is designed around the principle of data minimization and defense in depth:

- **Local-Only Architecture**: Kinana opens zero network sockets and makes zero external API requests. There is no cloud sync, remote telemetry, or third-party analytics.
- **Platform Credential Storage & Auto-Unlock Tradeoffs**:
  - Auto-Unlock is completely optional and disabled by default.
  - On Windows, credentials are stored in Windows Credential Manager protected by DPAPI and tied to the user login session.
  - On Linux, credentials use the Freedesktop Secret Service standard (`org.freedesktop.secrets` via GNOME Keyring, KWallet, or KeePassXC) over the user D-Bus session bus. Any process running under the same user UID with session bus access could query this service; users on shared or multi-tenant accounts should keep Auto-Unlock disabled.
  - On macOS, Auto-Unlock is currently not supported and remains disabled.
- **Clipboard Security**:
  - On Windows, copied credentials register clipboard exclusion formats (`ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory = 0`) to prevent capture by Windows Clipboard History (Win+V) and cloud clipboard sync.
  - On all platforms, copied secrets are automatically scrubbed from the primary system clipboard after approximately 15 seconds.
  - On Linux, third-party clipboard history daemons (such as CopyQ, GPaste, Diodon, or Klipper) listen independently to clipboard change events and record history into their own external databases. Standard X11/Wayland clipboard clearing cannot modify entries already captured by these independent background daemons. Users running persistent clipboard managers should configure them to exclude sensitive entries or disable clipboard history while managing secrets.
- **Threat Model Boundaries**:
  - Kinana protects strongly against offline device theft, disk inspection, file tampering, and brute-force attacks.
  - Kinana cannot protect against active malware, rootkits, keyloggers, or administrative compromise running on an infected host operating system.
  - The security of your vault relies fundamentally on the entropy of your master password and the safe retention of your Emergency Recovery Key. Kinana holds no backdoor recovery mechanisms.

---

## Recovery and Local Backup Behavior

### Emergency Recovery Key
During vault creation, Kinana generates a high-entropy Emergency Recovery Key. If you forget your master password, this recovery key is the only cryptographic method available to regain access to your vault data. Keep it stored in a safe offline location (such as on paper in a secure physical location).

### Start a New Vault (Reset Flow)
If you lose both your master password and your Emergency Recovery Key, cryptographic recovery is mathematically impossible. To allow you to continue using the application without manually locating and deleting hidden filesystem directories, Kinana provides a **Start a New Vault** option within the recovery dialog:

- **Not Password Recovery**: This option does not recover or decrypt your forgotten credentials.
- **Discards Local Vault**: It permanently deletes the local locked vault file, transaction journal, and local safety backups so you can create a fresh empty vault.
- **Explicit Confirmation**: The operation requires explicit destructive confirmation: you must type `RESET` in uppercase before the action is executed.
- **External Backups Preserved**: Previously exported external backup files (`.dat`) stored outside the application directory are not deleted.
- **Irreversible**: Once confirmed, existing local vault data is completely discarded and cannot be decrypted or restored.

### Encrypted Portable Backups (`.dat`)
Because Kinana does not synchronize across the cloud, you maintain full control of your backups:
- Export your vault at any time via **Settings** -> **Backup & Export** to generate an AES-256-GCM encrypted `.dat` file.
- The exported backup can be safely moved across computers via USB drive or local network share and imported using your master password.

---

## Quick Installation

### Windows (Stable)
1. Download [kinana-windows-x64-setup.exe](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe).
2. Run the installer. If Windows SmartScreen displays a warning, click **More info** then **Run anyway** (Kinana is an independent open-source project without a commercial EV certificate).
3. Follow the setup wizard to complete installation.

### Linux (Stable)
- **Debian / Ubuntu / Linux Mint (`.deb`)**:
  ```bash
  sudo apt install ./kinana-linux-x64.deb
  ```
- **Universal AppImage (`.AppImage`)**:
  ```bash
  chmod +x kinana-linux-x64.AppImage
  ./kinana-linux-x64.AppImage
  ```

### macOS (Preview)
1. Download the `.dmg` matching your processor architecture ([Apple Silicon](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) or [Intel](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg)).
2. Open the disk image and drag **Kinana** into your **Applications** folder.
3. On first launch, right-click **Kinana** in Finder and choose **Open**, or clear the quarantine attribute via Terminal:
   ```bash
   xattr -cr /Applications/Kinana.app
   ```

For comprehensive instructions, see the [Installation Guide](docs/installation.md).

---

## Development and Building from Source

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) (version 18 or later) with `npm`
- Platform C++ build tools (Visual Studio Build Tools on Windows, Xcode CLI on macOS, or `build-essential` on Linux)

### Setup Steps

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

### Running in Development

- **Desktop Application (Full Tauri Development)**:
  Runs both the Vite dev server and the native desktop Tauri application with full Rust IPC, crypto, and OS integration:
  ```bash
  npx --prefix ui tauri dev
  ```
  *(Alternatively, if `tauri-cli` is installed via Cargo: `cargo tauri dev`)*

- **Frontend Only (Browser Mockup)**:
  Runs only the Vite development server in the browser at `http://localhost:5173` without desktop Rust backend capabilities:
  ```bash
  npm --prefix ui run dev
  ```

### Building Production Bundles

Compile the optimized production desktop executable and platform bundle for your current operating system:
```bash
npx --prefix ui tauri build
```
*(Alternatively: `cargo tauri build`)*

Built installers and packages are generated in `target/release/bundle/`.

---

## Documentation

- [Installation Guide](docs/installation.md) - Platform-specific installation and troubleshooting.
- [Getting Started](docs/getting-started.md) - First-time setup, adding accounts, and recovery keys.
- [Security Architecture](docs/security.md) - Cryptographic primitives, binary vault format, and threat model.
- [Frequently Asked Questions (FAQ)](docs/faq.md) - Common operational and security inquiries.
- [Performance & Benchmarks](docs/benchmarks.md) - Measured memory utilization and bundle optimizations.
- [Changelog](CHANGELOG.md) - Version history and release notes.

---

## Security

Security vulnerabilities should be reported confidentially following the instructions in [SECURITY.md](SECURITY.md). Please do not report security issues via public GitHub issues.

---

## Contributing

Contributions, bug reports, and suggestions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

This project is licensed under the [MIT License](LICENSE).
