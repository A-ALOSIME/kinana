# Frequently Asked Questions (FAQ)

Answers to common questions about Kinana, its security architecture, and operational usage.

---

### Is Kinana really 100% offline?
Yes. Kinana contains zero networking code, zero analytics SDKs, and zero telemetry tracking. The application never opens outbound sockets or connects to remote servers. All your credentials and settings are stored locally on your own computer.

---

### What happens if I forget my master password?
Because Kinana does not use cloud servers or central databases, there is no "Forgot Password" email service. 

If you forget your master password, you must use your **Emergency Recovery Key** (which you were prompted to save when creating the vault).

If you lose both your master password and your Emergency Recovery Key, your existing data is cryptographically irrecoverable. In this scenario, you can use the **Start a New Vault** option in the recovery dialog to discard the locked local vault and create a fresh one (requires typing `RESET` in uppercase to confirm). Previously exported external `.dat` backups are not deleted.

---

### How do I sync or transfer my credentials between devices?
To move your vault to another machine:
1. In Kinana, go to **Settings** -> **Backup & Export** and export your encrypted vault file (`.dat`).
2. Copy the exported `.dat` file to your other computer (via a USB drive, local network share, or any secure file transfer method).
3. On the other computer, open Kinana, select **Import Existing Vault**, choose the `.dat` file, and enter your master password.

Because the export file is fully encrypted with AES-256-GCM using your master password, it is safe to handle and move.

---

### Why might Windows SmartScreen display a warning when I run the installer?
Because Kinana is an independent open-source project and its Windows binaries are currently distributed without a commercial digital code-signing certificate, Microsoft Defender SmartScreen may display a warning dialog stating "Windows protected your PC".

SmartScreen uses reputation-based analysis that evaluates digital signatures and file telemetry across Windows installations. A warning is expected for newly released or unsigned executables, though whether it appears varies depending on Windows edition, local system configuration, and enterprise policies (it does not appear on every installation).

An unsigned binary is not inherently malicious, but you should always ensure you downloaded it directly from the official [GitHub Releases](https://github.com/A-ALOSIME/kinana/releases) page and verify its SHA-256 hash against `SHA256SUMS.txt`. If Windows presents the option, click **More info** followed by **Run anyway**. Never disable Windows Defender, SmartScreen, or system antivirus protection.

---

### Why does macOS say "Kinana is damaged and can't be opened. You should eject the disk image"?
This message occurs when you double-click or attempt to launch Kinana directly from inside the mounted `.dmg` disk image window instead of dragging it to your Applications folder first.

macOS mounts disk image files as read-only volumes. When an application downloaded from the internet carries the `com.apple.quarantine` extended attribute and is launched directly from a read-only disk image, macOS attempts to invoke App Translocation. Because Kinana is distributed with an ad-hoc code signature rather than an Apple Developer ID certificate and notarization ticket, App Translocation cannot execute the app from the read-only volume and macOS defaults to displaying the misleading "damaged" dialog with an "Eject Disk Image" button.

The application bundle and disk image are not corrupted. To resolve this:
1. Click **Eject Disk Image** (or close the error dialog and eject the disk image in Finder).
2. Double-click `kinana-macos-arm64.dmg` (or `kinana-macos-x64.dmg`) to re-mount the disk image.
3. Drag the **Kinana** icon into the **Applications** folder shortcut inside the window.
4. Eject the disk image.
5. Open your **Applications** folder and launch Kinana from there (see the next question for first-time launch steps).

---

### Why does macOS show a warning about an unverified developer?
Kinana macOS packages are currently marked as Preview because they have not yet undergone comprehensive manual testing across physical Mac hardware. 

The application bundle is sealed with an ad-hoc code signature (`codesign -s -`) to ensure internal binary integrity and valid structure on Apple Silicon and Intel systems, but it is not signed with a paid Apple Developer ID certificate or notarized by Apple. As a result, Apple Gatekeeper may block direct double-clicking with a message stating that the developer cannot be verified or that Apple cannot check it for malicious software.

To open the application:
1. Open your **Applications** folder in Finder.
2. Right-click (or Control-click) the **Kinana** app icon and select **Open**.
3. In the confirmation dialog, click **Open**.
4. On macOS Ventura, Sonoma, and Sequoia: If direct opening is prevented, navigate to **Apple menu -> System Settings -> Privacy & Security**, scroll down to the Security section, and click **Open Anyway**.

Advanced users may alternatively remove the quarantine extended attribute assigned specifically to the Kinana bundle via Terminal:
```bash
xattr -d com.apple.quarantine /Applications/Kinana.app
```
This clears the download quarantine flag for Kinana.app only; never disable Gatekeeper globally. Note that Gatekeeper warnings cannot always be bypassed if strict enterprise MDM policies are active.

---

### What desktop platforms are supported?
Kinana officially supports:
- **Windows**: Windows 10 and Windows 11 (x86_64) - Stable.
- **Linux**: Modern 64-bit Linux distributions via `.deb` (Debian/Ubuntu/Mint) and standalone `.AppImage` - Stable (tested on development distributions; compatibility is not claimed across every Linux distribution or hardware configuration).
- **macOS (Preview)**: macOS 10.15+ on both Apple Silicon (M1/M2/M3/M4, `arm64`) and Intel (`x86_64`).

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
