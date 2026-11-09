# Frequently Asked Questions (FAQ)

Answers to common questions about Kinana, its security architecture, and operational usage.

---

### Is Kinana really 100% offline?
Yes. Kinana contains zero networking code, zero analytics SDKs, and zero telemetry tracking. The application never opens outbound sockets or connects to remote servers. All your credentials and settings are stored locally on your own computer.

---

### What happens if I forget my master password?
Because Kinana does not use cloud servers or central databases, there is no "Forgot Password" email service. 

If you forget your master password, you must use your **Emergency Recovery Key** (which you were prompted to save when creating the vault). If you lose both your master password and your Emergency Recovery Key, your data is cryptographically irrecoverable.

---

### How do I sync or transfer my credentials between devices?
To move your vault to another machine:
1. In Kinana, go to **Settings** -> **Backup & Export** and export your encrypted vault file (`.dat`).
2. Copy the exported `.dat` file to your other computer (via a USB drive, local network share, or any secure file transfer method).
3. On the other computer, open Kinana, select **Import Existing Vault**, choose the `.dat` file, and enter your master password.

Because the export file is fully encrypted with AES-256-GCM using your master password, it is safe to handle and move.

---

### Why does Windows SmartScreen display a warning when I run the installer?
Windows SmartScreen displays a warning banner ("Windows protected your PC") for new executable files that lack an expensive commercial Extended Validation (EV) code-signing certificate.

Kinana is an independent, non-profit open-source project. To continue with installation:
1. Click **More info**.
2. Click **Run anyway**.

You can also independently verify the SHA-256 checksum of your downloaded installer against the official release hashes listed in `SHA256SUMS.txt`.

---

### Why does macOS show a warning about an unverified developer?
On macOS, Gatekeeper checks for Apple Developer notarization tickets. Because Kinana binaries are currently distributed as an open-source community release without an active Apple Developer subscription:
1. Right-click (or Control-click) the **Kinana** app icon in Finder.
2. Select **Open**.
3. Confirm by clicking **Open** in the dialog.

Alternatively, open Terminal and run:
```bash
xattr -cr /Applications/kinana.app
```
This is only required once on first launch.

---

### What desktop platforms are supported?
Kinana officially supports:
- **Windows**: Windows 10 and Windows 11 (x86_64).
- **macOS (Preview)**: macOS 10.15+ on both Apple Silicon (M1/M2/M3/M4, `arm64`) and Intel (`x86_64`).
- **Linux (Preview)**: Modern 64-bit Linux distributions via `.deb` (Debian/Ubuntu/Mint) and standalone `.AppImage`.

---

### How does the Auto-Lock timer work?
Kinana continuously monitors mouse and keyboard input activity within the desktop application window. When no input has been detected for your selected duration (e.g. 5 minutes), the vault automatically locks and scrubs sensitive keys from memory.

If you are actively typing inside an account creation or editing form, the timer automatically pauses to ensure your unsaved work is not interrupted.

---

### Can I run Kinana without installing it?
- On **Linux**, you can run the standalone `kinana-linux-x64.AppImage` directly without installing it to your system.
- On **Windows**, the primary distribution is the NSIS installer (`kinana-windows-x64-setup.exe`).

---

### Which cryptographic algorithms protect my data?
- **Key Derivation**: Argon2id with 64 MiB memory, 3 iterations, and 4 threads.
- **Payload Encryption**: AES-256-GCM with a 96-bit random nonce and 128-bit authentication tag.
- **Integrity**: Authenticated Additional Data (AAD) covering the entire 66-byte binary header.
- **Memory Security**: Rust `Zeroize` memory wipes upon drop or lock.

---

### Is Kinana free and open source?
Yes. Kinana is released under the permissive [MIT License](../LICENSE). You are free to inspect the source code, build it locally, or contribute improvements.
