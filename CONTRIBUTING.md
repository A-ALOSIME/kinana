# Contributing to Kinana

Thank you for your interest in contributing to Kinana. Kinana is an open-source, offline-first desktop password manager built with Rust, Tauri 2, and React.

---

## Code of Conduct

We are committed to providing a welcoming, constructive, and harassment-free environment for everyone. Please be respectful, professional, and collaborative in all interactions.

---

## Development Prerequisites

To build and test Kinana locally, ensure you have the following installed:

1. **Rust Toolchain**: Stable Rust (latest version recommended) installed via `rustup`.
2. **Node.js and npm**: Node.js 18 LTS or newer.
3. **Platform-Specific Dependencies**:
   - **Windows**: Microsoft C++ Build Tools (via Visual Studio Installer) and Edge WebView2.
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
   - **Linux**: Build essentials and WebKitGTK libraries:
     ```bash
     sudo apt update && sudo apt install -y \
       build-essential \
       curl \
       libwebkit2gtk-4.1-dev \
       libayatana-appindicator3-dev \
       librsvg2-dev \
       patchelf
     ```

---

## Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/A-ALOSIME/kinana.git
   cd kinana
   ```

2. **Install frontend dependencies**:
   ```bash
   cd ui
   npm install
   cd ..
   ```

3. **Run the development application**:
   ```bash
   npm --prefix ui run dev
   ```

---

## Running Verification Tests

Before submitting any changes, you must ensure that all test suites pass without warnings or regressions.

1. **Rust Test Suite**:
   ```bash
   cargo test --workspace
   ```

2. **Rust Release Compilation Check**:
   ```bash
   cargo check --release --workspace
   ```

3. **Frontend Build & Test**:
   ```bash
   cd ui
   npm test
   npm run build
   cd ..
   ```

4. **Security Audit**:
   ```bash
   cargo audit --file Cargo.lock
   npm audit --prefix ui --audit-level=high
   ```

---

## Contribution Guidelines

1. **Security First**: Any modifications affecting cryptographic functions, vault serialization, memory zeroization, or key storage must be accompanied by comprehensive tests and rationale.
2. **Offline-First Commitment**: Kinana will never include external cloud synchronization or network tracking. Do not submit pull requests introducing telemetry or third-party cloud services.
3. **Commit Messages & Code Standards**:
   - Write clear, concise commit messages following standard conventions.
   - Do not include emojis in code, comments, or commit messages.
   - Maintain strict typing in TypeScript and idiomatic error handling in Rust.
4. **Pull Requests**:
   - Open a pull request against the `main` branch.
   - Provide a clear description of the problem solved and the tests conducted.
   - Ensure all automated GitHub Actions checks pass.
