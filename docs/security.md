# Security Architecture and Threat Model

This document outlines the cryptographic design, threat model, and operational security guarantees of Kinana.

---

## 1. Core Principles

- **Zero Cloud and Zero Network Activity**: Kinana does not connect to any remote server, cloud API, or analytics service. The desktop binary opens zero network listeners and makes zero outbound HTTP/HTTPS requests.
- **Client-Side Cryptography**: All cryptographic key derivation, encryption, and decryption happen strictly in local memory on your machine.
- **Defense in Depth**: Every layer, from memory zeroization to write-ahead journaling and authenticated encryption, is designed to prevent data leakage and data corruption.

---

## 2. Cryptographic Architecture

### Key Derivation Function (KDF): Argon2id
Kinana utilizes **Argon2id** (the hybrid version of Argon2, winner of the Password Hashing Competition) to derive 256-bit encryption keys from user master passwords.

Default parameters for desktop security:
- **Algorithm**: Argon2id (RFC 9106)
- **Memory Cost (`m_cost`)**: 64 MiB (65,536 KiB)
- **Time Cost (`t_cost`)**: 3 iterations
- **Parallelism (`p_cost`)**: 4 threads
- **Salt**: 32 bytes (256 bits) generated cryptographically via `OsRng`
- **Output Key Length**: 32 bytes (256 bits)

These parameters provide strong resistance against GPU-accelerated and ASIC-based offline dictionary attacks while completing in a fraction of a second on modern consumer CPUs. Defensive bounds (`16 MiB <= m_cost <= 512 MiB`, `1 <= t_cost <= 10`, `1 <= p_cost <= 16`) are enforced during header deserialization to mitigate denial-of-service attempts from malformed files.

### Authenticated Encryption: AES-256-GCM
Kinana uses **AES-256-GCM** (Galois/Counter Mode) for authenticated symmetric encryption of the vault payload.

- **Key Size**: 256 bits.
- **Nonce Size**: 96 bits (12 bytes), freshly generated per save operation using the operating system's CSPRNG (`OsRng`).
- **Authentication Tag Size**: 128 bits (16 bytes).

### Binary Vault Format (`PORTVLT1`)
A Kinana vault file (`.dat`) has a strict binary layout:

| Offset | Length | Field | Description |
|---|---|---|---|
| 0 | 8 bytes | Magic Bytes | ASCII string `PORTVLT1` |
| 8 | 2 bytes | Format Version | Unsigned 16-bit integer (currently `1`) |
| 10 | 4 bytes | `m_cost` | Argon2 memory cost in KiB |
| 14 | 4 bytes | `t_cost` | Argon2 time cost / iterations |
| 18 | 4 bytes | `p_cost` | Argon2 parallelism / threads |
| 22 | 32 bytes | Salt | Cryptographic salt for master key derivation |
| 54 | 12 bytes | Nonce | AES-GCM 96-bit initialization vector |
| 66 | Variable | Ciphertext + Tag | Encrypted vault payload ending with a 16-byte authentication tag |

**Additional Authenticated Data (AAD)**:
The entire 66-byte header is passed as Additional Authenticated Data (AAD) into AES-256-GCM. Any attempt to modify the header fields (such as downgrading Argon2 costs or tampering with the salt) causes the cryptographic tag verification to fail immediately, preventing decryption.

---

## 3. Emergency Recovery Mechanism

Kinana supports vault recovery using an **Emergency Recovery Key**:
- A distinct, high-entropy 256-bit recovery key is generated when the vault is first initialized.
- A secondary encrypted recovery payload is maintained in parallel.
- Deriving the key from the recovery passphrase uses independent Argon2id salt and parameters.
- Recovering a vault restores access and immediately prompts the user to configure a new master password, establishing new cryptographic salts and nonces.

---

## 4. Crash-Safe Transaction Journal

To prevent vault file corruption during sudden system crashes, power outages, or accidental application termination during write operations:
- Kinana maintains an atomic write-ahead transaction journal (`.journal`).
- Before modifying the active vault or executing an import/restore operation, Kinana generates safety copies (`.vbak` and `.rbak`).
- If an operation fails midway or an unexpected interruption occurs, the journal automatically rolls back changes to the verified safety copy upon the next startup.

---

## 5. Memory Hygiene and Zeroization

- Sensitive data structures, including derived cryptographic keys, decrypted vault buffers, and temporary passphrase representations, implement the Rust `Zeroize` and `Zeroizing` patterns.
- Upon drop or scope exit, sensitive memory regions are securely overwritten with zeros to reduce the window of exposure to memory-dump analysis.
- On Windows, Kinana calls Win32 working set trimming APIs upon lock or minimization, reducing idle memory exposure.

---

## 6. Threat Model

### In Scope (What Kinana Protects Against)
- **Stolen Devices and Physical Drive Inspection**: If an attacker obtains an encrypted Kinana vault file (`.dat`) or steals your laptop's storage drive, they cannot read the contents without knowledge of your master password or recovery key.
- **Offline Brute-Force Attacks**: Argon2id memory hardness prevents efficient massive parallel attacks on GPUs or dedicated hardware.
- **Network Eavesdropping**: Kinana performs zero network communications, eliminating man-in-the-middle, DNS spoofing, and cloud-breach attack vectors.
- **Data Tampering and Bit Flipping**: AES-256-GCM authentication ensures any modification to ciphertext or file headers is detected and rejected.
- **Accidental Corruption**: The transaction journal safeguards against partially written vault files.

### Out of Scope (User Responsibility & Environment Boundaries)
- **Compromised Host OS / Active Malware**: If an attacker has administrative, root, or kernel-level access to your operating system while the vault is unlocked, they can intercept keystrokes (keylogger), inspect process memory, or inject code into running applications. Kinana cannot protect against a compromised operating system.
- **Weak Master Passwords**: Cryptographic strength relies fundamentally on master password entropy. Users should select a unique, high-entropy passphrase.
- **Physical Loss without Recovery Key**: Because Kinana does not store your password or retain backdoor access, losing both your master password and your emergency recovery key results in permanent, irrecoverable loss of vault data.
