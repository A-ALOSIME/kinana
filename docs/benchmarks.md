# Performance and Resource Benchmarks

This document provides transparent, measured resource utilization data for Kinana across different operational states.

---

## Architecture Overview

Kinana combines a lightweight, native Rust core binary with a web-based presentation layer powered by Tauri and the system-native webview (Microsoft Edge WebView2 on Windows, WebKit on macOS, and WebKitGTK on Linux).

Because modern webview engines allocate memory for hardware-accelerated composition (GPU surfaces), styling, and DOM rendering, Kinana implements active resource optimizations to minimize its memory footprint during idle and background operation.

---

## Memory Utilization Measurements (Windows 11 x86_64)

The following metrics were captured under real operating conditions:

| Application State | Total Working Set | Private Bytes | Description |
|---|---|---|---|
| **Background / Minimized / Locked** | **42.27 MB** | 186.70 MB | Automatic Win32 working set trimming flushes inactive pages from RAM |
| **Active Interface (Foreground)** | 398.89 MB | 220.23 MB | Full GPU composition, smooth animations, and active DOM tree |
| **Native Rust Core Process** | **3.02 MB** | 8.48 MB | Isolated execution cost of the native Rust logic without Webview overhead |

---

## Resource Optimization Strategies

### 1. Lazy-Loaded Service Catalog
The built-in service catalog contains 128 encrypted service cover profiles and iconography. In earlier versions, this catalog was embedded into the initial application bundle.

In Kinana 0.1.1+, the service cover module is isolated into an asynchronous, dynamically imported chunk loaded only when opening the service selection picker. This reduced the primary JavaScript bundle (`index.js`) from **1.25 MB** down to **448 KB** (a 64% reduction in initial parsing and execution overhead).

### 2. High-Efficiency Font Compression
The default Arabic typeface (Thmanyah Sans) was converted from raw OTF format to modern WOFF2 compression without any loss of typographical fidelity. This reduced font asset overhead from **1.2 MB** down to **156 KB**.

### 3. Automatic Working Set Trimming
When the Kinana window loses focus, is minimized to the system tray, or locks due to inactivity, Kinana issues a Win32 API call to trim non-essential physical memory pages from the process working set. This immediately releases active RAM back to the operating system, dropping overall memory consumption to approximately 42 MB until the user brings the application back to the foreground.

---

## Cryptographic Performance

Argon2id key derivation runs on a dedicated background thread to prevent UI freezing during vault unlocking and rekeying:
- Standard desktop parameters: `m_cost = 64 MiB`, `t_cost = 3`, `p_cost = 4`.
- Average derivation duration on modern multicore desktop processors: ~280ms to ~450ms.
- AES-256-GCM symmetric decryption and JSON deserialization complete in less than 5ms for typical vaults containing hundreds of credentials.
