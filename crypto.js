// Crypto module: AES-256-GCM encryption with PBKDF2 key derivation
const Vault = (() => {
  const PBKDF2_ITERATIONS = 600000;
  const SALT_LEN = 16;
  const IV_LEN = 12;

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(password, data) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    const buf = new Uint8Array(salt.length + iv.length + ct.byteLength);
    buf.set(salt, 0);
    buf.set(iv, salt.length);
    buf.set(new Uint8Array(ct), salt.length + iv.length);
    return btoa(String.fromCharCode(...buf));
  }

  async function decrypt(password, b64) {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const salt = raw.slice(0, SALT_LEN);
    const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const ct = raw.slice(SALT_LEN + IV_LEN);
    const key = await deriveKey(password, salt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function save(password, accounts) {
    const encrypted = await encrypt(password, accounts);
    await browser.storage.local.set({ vault: encrypted });
  }

  async function load(password) {
    const { vault } = await browser.storage.local.get('vault');
    if (!vault) return [];
    return decrypt(password, vault);
  }

  async function hasVault() {
    const { vault } = await browser.storage.local.get('vault');
    return !!vault;
  }

  // Hint is stored unencrypted (it's meant to be visible on lock screen)
  async function saveHint(hint) {
    await browser.storage.local.set({ vaultHint: hint || '' });
  }

  async function getHint() {
    const { vaultHint } = await browser.storage.local.get('vaultHint');
    return vaultHint || '';
  }

  return { encrypt, decrypt, save, load, hasVault, saveHint, getHint };
})();
