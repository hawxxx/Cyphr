# Cyphr

A Firefox extension (Manifest V2) for local-only, master-password-encrypted TOTP management with whitelisted domain autofill.

Vault data is stored locally using `browser.storage.local`. Icon lookup uses external favicon services, and the popup loads fonts from Google Fonts.

## Features

- **AES-256-GCM Encryption** — Vault encrypted with a master password using PBKDF2 with 600,000 iterations
- **RFC 6238 TOTP** — Standards-compliant time-based one-time password generation (SHA-1, SHA-256, SHA-512)
- **Whitelisted Domain Autofill** — Automatically detects OTP fields on configured domains and fills codes inline
- **Auto-submit** — Optionally submit the form after autofill (disabled by default)
- **Inline Popup** — Floating popup on matched pages with live countdown, copy, and autofill buttons
- **Issuer Favicons** — Automatic favicon resolution via Google Favicon API, with initials as a fallback
- **Search** — Filter saved accounts by issuer, account name, or domain
- **QR Code Import** — Scan QR codes via camera or image upload to add accounts
- **Export/Import** — Export vault as encrypted (AES-256-GCM) or plaintext JSON; import with merge or replace
- **Auto-copy to Clipboard** — Optionally copy generated codes to clipboard automatically
- **Clipboard Expiration** — Configurable auto-clear (never, 15s, 30s, 1m, 2m)
- **Keyboard Shortcut** — `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS) to autofill the current page
- **Context Menu** — Right-click any editable field to autofill
- **Session Lock** — Optional auto-lock after 5 minutes of inactivity (off by default; the session does not expire unless enabled); optional "remember session" mode
- **Password Hint** — Optional plaintext hint displayed on the lock screen

## Installation

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file from this directory

For persistent installation, package the extension as an `.xpi` file and sign it through [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/).

Cyphr uses the extension ID `cyphr@hawxxx.github.io`. To migrate from another installation, export your vault first, then import it into Cyphr. Browser storage is separate for each extension ID.

To sign a release, set `MOZILLA_API_ISSUER` and `MOZILLA_API_SECRET` in your environment, or set `CYPHR_ENV_FILE` to a local credentials file, then run `bash build.sh patch`. Signing submits the extension to Mozilla and produces an XPI in `web-ext-artifacts/`. Keep credentials and vault exports out of Git.

## File Structure

| File | Description |
|---|---|
| `manifest.json` | Extension manifest (MV2) with permissions, content scripts, and commands |
| `background.js` | Message broker: vault operations, settings, export/import, QR decode, clipboard |
| `popup.html` | Extension popup UI: lock screen, dashboard, settings, export/import, QR scanner, about |
| `popup.js` | Popup controller: view navigation, account rendering, search, settings wiring |
| `content.js` | Content script: OTP field detection, inline popup, autofill, auto-submit |
| `totp.js` | RFC 6238 TOTP implementation with HMAC-SHA1/256/512 |
| `crypto.js` | AES-256-GCM encryption/decryption with PBKDF2 key derivation |
| `jsQR.min.js` | QR code decoder library (jsQR v1.4.0) |
| `icons/` | Extension icons |

## Settings

Access settings via the gear icon in the dashboard header.

| Setting | Default | Description |
|---|---|---|
| Auto-fill on whitelisted sites | On | Show inline popup and fill codes on matched domains |
| Auto-copy code to clipboard | Off | Copy TOTP code to clipboard when generated |
| Clipboard expiration | 30 seconds | Clear clipboard after copying (never/15s/30s/1m/2m) |
| Auto-submit after autofill | Off | Submit the form automatically after filling the code |
| Expire session on inactivity | Off | Auto-lock the vault after 5 minutes idle. When off, the session stays unlocked until you lock it manually or close the browser |

## Adding Accounts

Three methods to add TOTP accounts:

1. **Manual entry** — Click `+`, enter issuer, account, Base32 secret, and whitelisted domains
2. **otpauth:// URL** — Paste a full `otpauth://totp/...` URL; fields auto-populate
3. **QR code scan** — Settings > Scan QR Code; use camera or upload an image

## Security

- Master password never leaves the device
- Vault encrypted at rest with AES-256-GCM
- Key derived using PBKDF2 with 600,000 iterations and a random 16-byte salt
- External requests include favicon lookup, site favicon fallback, custom icon URLs, and Google Fonts; vault storage remains local
- Optional auto-lock after 5 minutes of inactivity (disabled by default; enable "Expire session on inactivity" in settings)
- "Remember session" mode caches the password in memory only until browser close or manual lock

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Store encrypted vault and settings locally |
| `activeTab` | Access current tab URL for domain matching |
| `contextMenus` | Right-click autofill menu item |
| `clipboardWrite` | Copy TOTP codes to clipboard |
| `downloads` | Export vault as JSON file |
| `<all_urls>` (content script) | Detect OTP fields and show inline popup on any site |
