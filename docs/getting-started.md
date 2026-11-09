# Getting Started with Kinana

This guide walks you through the essential steps to configure and use Kinana to manage your passwords and credentials safely.

---

## 1. Initial Launch and Vault Creation

When you launch Kinana for the first time, you will be prompted to create a new vault or import an existing one.

### Creating a New Vault
1. Select **Create New Vault**.
2. Enter a strong master password.
3. Confirm your master password.
4. Click **Create Vault**.

> Note: Kinana is an offline-first password manager. Your master password is never transmitted over a network and is never stored in plaintext anywhere. It cannot be reset via email or customer support.

---

## 2. Emergency Recovery Key

Immediately after creating your vault, Kinana generates an **Emergency Recovery Key**.

### Best Practices for Your Recovery Key
- **Record it immediately**: Write down the recovery key on paper or store it in a secure physical location (such as a safe).
- **Do not store it on the same device in plaintext**: Avoid saving the recovery key in an unencrypted text file on your desktop.
- **Why it matters**: If you forget your master password, the Emergency Recovery Key is the only cryptographic method available to regain access to your vault data.

---

## 3. Adding and Managing Credentials

Kinana supports two primary credential types: **Service Accounts** and **Payment Cards**.

### Adding a Service Account
1. Click the **Add Account** button in the top toolbar.
2. Select the service from the catalog or type a custom service name.
3. Enter your username or email address.
4. Enter your password or use the built-in password generator to create a strong, random password.
5. Optionally add custom notes or tags.
6. Click **Save**.

### Managing Display and Copying
- **Password Visibility**: Passwords are masked with dots by default. Click the eye toggle icon to reveal or conceal them.
- **One-Click Copy**: Click the copy icon next to any username or password to copy it to the clipboard. Kinana clears clipboard contents according to your configured privacy settings.
- **View Modes**: Switch between **Poster Grid** view and **List View** using the toggle icons in the toolbar.
- **Card Sorting**: Drag and drop service cards to pin your most-used services at the top, or use the alphabetical sorting button.

---

## 4. Payment Cards

Kinana provides specialized, secure storage for banking and payment cards (Mada, Visa, Mastercard):

1. Switch to the **Cards** section.
2. Click **Add Card**.
3. Fill in the cardholder name, card number, expiration date, and CVV/PIN.
4. Sensitive numbers are automatically masked on screen until you choose to reveal them.

---

## 5. Security and Auto-Lock

To protect your credentials when you step away from your workstation:

1. Open **Settings** (gear icon).
2. Under **Auto-Lock**, choose your preferred inactivity timeout:
   - 1 minute
   - 5 minutes (default)
   - 10 minutes
   - 15 minutes
   - 30 minutes
   - 1 hour
   - Custom timeout
   - Never (disables auto-lock)
3. Kinana continuously monitors input activity. If you are actively typing inside a form, the auto-lock timer is automatically suspended to prevent accidental data loss.

---

## 6. Backups and Cross-Device Transfer

Because Kinana does not rely on a central cloud server, you retain total ownership of your backups.

### Exporting an Encrypted Backup
1. Navigate to **Settings** -> **Backup & Export** (or click the export button in the navigation header).
2. Click **Export Vault**.
3. Save the resulting `.dat` file to your desired location (e.g., an encrypted USB drive).
4. The backup file is encrypted with AES-256-GCM using your master password. It is completely safe to transport across insecure media.

### Importing a Backup
- **On a new device**: Choose **Import Existing Vault** on the initial setup screen, select your `.dat` file, and provide the master password.
- **On an existing installation**: Open **Settings** -> **Backup & Export** and select **Import Vault**. Kinana automatically creates a safety backup of your existing vault before performing the import, ensuring that no data is lost even if the import process is interrupted.

---

## 7. Emergency Recovery Flow

If you ever forget your master password:

1. On the lock screen, click **Use Recovery Key**.
2. Carefully type or paste your saved Emergency Recovery Key.
3. Click **Recover Vault**.
4. Once unlocked, immediately navigate to **Settings** to set a new master password and generate a new recovery key.
