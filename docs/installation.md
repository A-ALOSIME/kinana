# Installation Guide

This document provides step-by-step installation instructions for Kinana across all supported desktop platforms.

---

## Downloads

Download the appropriate installer for your operating system from the latest release:

| Platform | Architecture | Package Format | Download Link | Status |
|---|---|---|---|---|
| **Windows** | x86_64 (64-bit) | NSIS Installer (`.exe`) | [Download Windows Installer](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-windows-x64-setup.exe) | Stable |
| **Linux** | x86_64 | Debian / Ubuntu (`.deb`) | [Download Linux DEB](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.deb) | Stable |
| **Linux** | x86_64 | Universal (`.AppImage`) | [Download Linux AppImage](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.AppImage) | Stable |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | Apple Disk Image (`.dmg`) | [Download macOS Apple Silicon DMG](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-arm64.dmg) | Preview |
| **macOS** | Intel (x86_64) | Apple Disk Image (`.dmg`) | [Download macOS Intel DMG](https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-macos-x64.dmg) | Preview |

To verify download authenticity, download the checksum file:
[SHA256SUMS.txt](https://github.com/A-ALOSIME/kinana/releases/latest/download/SHA256SUMS.txt)

> Note: Linux packages (DEB and AppImage) are classified as Stable based on development and test distribution verification; compatibility is not claimed across every Linux distribution or hardware configuration. macOS builds remain in Preview pending comprehensive manual hardware testing.

---

## Windows Installation

### System Requirements
- Windows 10 or Windows 11 (64-bit).
- Microsoft Edge WebView2 Evergreen Runtime (pre-installed on modern Windows 10/11; installed automatically by the installer if absent).

### Installation Steps
1. **Download**: Download `kinana-windows-x64-setup.exe` directly from the official [GitHub Releases](https://github.com/A-ALOSIME/kinana/releases) page.
2. **Verify Integrity (Recommended)**: Check the downloaded file's SHA-256 hash using PowerShell:
   ```powershell
   Get-FileHash -Algorithm SHA256 .\kinana-windows-x64-setup.exe
   ```
   Confirm that the calculated hash matches the value listed in [SHA256SUMS.txt](https://github.com/A-ALOSIME/kinana/releases/latest/download/SHA256SUMS.txt).
3. **Run the Installer**: Double-click `kinana-windows-x64-setup.exe` to begin installation.
4. **Microsoft Defender SmartScreen Notice**:
   Because Kinana is an independent open-source project and its binaries are currently distributed without a commercial digital code-signing certificate, Microsoft Defender SmartScreen may display a warning dialog stating "Windows protected your PC".
   - **Why this occurs**: SmartScreen evaluates digital signatures and file reputation across Windows installations. Newly released or unsigned binaries may trigger this notice depending on your Windows edition, local security policies, and telemetry settings. This warning does not appear on every Windows machine.
   - **Verifying authenticity**: An unsigned binary is not inherently malicious, but you should always ensure you obtained the installer directly from the official GitHub repository and verified its SHA-256 hash.
   - **Proceeding safely**: If Windows displays this prompt and offers the action, click **More info** followed by **Run anyway** to proceed with installation.
   - **Important**: Never disable Windows Defender, SmartScreen, or system antivirus protection.
5. **Complete Setup**: Follow the on-screen installer instructions. Once finished, launch Kinana from the Start Menu or desktop shortcut.

---

## macOS Installation (Preview)

### System Requirements
- macOS 10.15 (Catalina) or later.
- For Apple Silicon Macs (M1, M2, M3, M4): use `kinana-macos-arm64.dmg`.
- For Intel-based Macs: use `kinana-macos-x64.dmg`.

### Installation Steps
1. Download the `.dmg` file matching your Mac's processor architecture from the official [GitHub Releases](https://github.com/A-ALOSIME/kinana/releases) page.
2. Double-click the downloaded `.dmg` file to mount it.
3. Drag the **Kinana** application icon into your **Applications** folder.
4. Eject the disk image.

### Unsigned Application Notice (Apple Gatekeeper)
Kinana macOS packages are currently marked as Preview because they have not yet undergone comprehensive manual testing across diverse physical Mac hardware. The binaries are currently unsigned and not notarized with Apple. Consequently, Apple Gatekeeper may block direct opening with a prompt indicating that the developer cannot be verified or that Apple cannot check the app for malicious software.

#### Preferred Graphical Method (Standard macOS Flow)
1. Open your **Applications** folder in Finder.
2. Right-click (or Control-click) on **Kinana** and select **Open** from the context menu.
3. In the confirmation dialog, click **Open**.
4. **On macOS Ventura, Sonoma, and Sequoia**: If direct opening is prevented:
   - Open **Apple menu -> System Settings -> Privacy & Security**.
   - Scroll down to the **Security** section.
   - Look for the notification stating that Kinana was blocked from opening, and click **Open Anyway**.
   - Confirm by entering your Mac account password or Touch ID when prompted.

*(Note: Gatekeeper restrictions cannot always be bypassed if your Mac is enrolled in an enterprise Mobile Device Management (MDM) profile that enforces strict signature requirements).*

#### Advanced Terminal Option
If preferred by advanced users, you can remove the download quarantine flag assigned specifically to the Kinana application bundle using Terminal:
```bash
xattr -d com.apple.quarantine /Applications/Kinana.app
```
This command removes only the `com.apple.quarantine` extended attribute from the Kinana app bundle without modifying any other applications on your system. Never disable Gatekeeper globally (`spctl --master-disable`).

---

## Linux Installation

### Debian and Ubuntu-based Distributions (.deb)

#### Requirements
- Ubuntu 20.04 LTS / 22.04 LTS / 24.04 LTS, Debian 11 / 12, Linux Mint, or compatible distribution.
- Dependencies: `libwebkit2gtk-4.1-0` (or `4.0`), `libayatana-appindicator3-1`.

> Note: Starting with v0.1.3, the Debian package strictly conforms to Debian package naming standards (`Package: kinana`) while displaying **Kinana** consistently in desktop launchers (`Name=Kinana`). The `.deb` package contains zero custom maintainer scripts and passes automated `dpkg-deb` metadata inspection and `apt` installation smoke checks.

#### Installation via Terminal
```bash
# Download the package
wget https://github.com/A-ALOSIME/kinana/releases/latest/download/kinana-linux-x64.deb

# Install using apt (resolves any missing system libraries automatically)
sudo apt install ./kinana-linux-x64.deb

# Launch the application
kinana
```

#### Note on Linux Mint Graphical Package Installer (`gdebi-gtk`)
On Linux Mint systems, installing `.deb` packages via the graphical Package Installer (`gdebi-gtk`) can leave the `gdebi-gtk` window open with an unresponsive close button after completion or failure. Verification of Kinana's `kinana-linux-x64.deb` archive confirms the package contains only static binary/icon/desktop files, zero Debian maintainer scripts (`preinst`, `postinst`, `prerm`, `postrm`), and zero installer background processes; the hang belongs to upstream `gdebi-gtk` / PolicyKit (`pkexec`) / `aptdaemon` window sensitivity handling and can occur with other `.deb` packages as well.

Installing via terminal (`sudo apt install ./kinana-linux-x64.deb`) or Mint's native Software Installer avoids this issue completely. If a graphical `gdebi-gtk` window stays stuck after installation finishes, you can safely close only that installer window via terminal:
```bash
pkill gdebi-gtk
```

---

### Universal Standalone Executable (.AppImage)

The AppImage package runs on almost all modern 64-bit Linux distributions without requiring installation.

> Note: Starting with v0.1.3, host process spawning (such as opening the vault directory in Nemo, Nautilus, Dolphin, or Thunar) is isolated from AppImage runtime environment variables to ensure compatibility with host libraries. Starting with v0.1.4, Kinana also defaults `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` on Linux (unless overridden in your environment) to prevent intermittent blank/black rectangular compositing glitches in WebKitGTK on affected GPU drivers while stripping that setting from spawned host apps.

#### Requirements
- FUSE (Filesystem in Userspace) support. On Ubuntu 22.04+, install FUSE 2 if needed:
  ```bash
  sudo apt install libfuse2
  ```

#### Steps
1. Download `kinana-linux-x64.AppImage`.
2. Make the file executable:
   ```bash
   chmod +x kinana-linux-x64.AppImage
   ```
3. Run the application:
   ```bash
   ./kinana-linux-x64.AppImage
   ```

---

## Verifying Download Authenticity

Every release includes an official `SHA256SUMS.txt` file containing cryptographic hashes of all distributed packages.

### On Windows (PowerShell)
```powershell
Get-FileHash -Algorithm SHA256 .\kinana-windows-x64-setup.exe
```
Compare the output against the corresponding line in `SHA256SUMS.txt`.

### On macOS
```bash
shasum -a 256 kinana-macos-arm64.dmg
```

### On Linux
```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```
If the check succeeds, it will print `kinana-linux-x64.deb: OK` or `kinana-linux-x64.AppImage: OK`.
