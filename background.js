// Background script: message broker between popup and content scripts
let cachedPassword = null;
let lockTimeout = null;
let rememberSession = false;
let clipboardTimer = null;
let sessionExpiresEnabled = false; // cached from settings; default: session does NOT expire
const AUTO_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_SETTINGS = { autofillEnabled: true, autoCopy: false, clipboardExpiry: 30, autoSubmit: false, sessionExpires: false };

const ISSUER_DOMAINS = {
  github:'github.com',google:'google.com',aws:'aws.amazon.com',amazon:'amazon.com',
  microsoft:'microsoft.com',azure:'azure.microsoft.com',apple:'apple.com',
  facebook:'facebook.com',meta:'meta.com',twitter:'twitter.com',x:'x.com',
  discord:'discord.com',slack:'slack.com',gitlab:'gitlab.com',bitbucket:'bitbucket.org',
  dropbox:'dropbox.com',stripe:'stripe.com',twilio:'twilio.com',
  cloudflare:'cloudflare.com',digitalocean:'digitalocean.com',heroku:'heroku.com',
  npm:'npmjs.com',docker:'docker.com',reddit:'reddit.com',linkedin:'linkedin.com',
  steam:'steampowered.com',epic:'epicgames.com',coinbase:'coinbase.com',
  binance:'binance.com',okta:'okta.com',auth0:'auth0.com',onelogin:'onelogin.com',
  zoom:'zoom.us',figma:'figma.com',notion:'notion.so',jira:'jira.atlassian.com',
  atlassian:'atlassian.com',twitch:'twitch.tv',nvidia:'nvidia.com',
  paypal:'paypal.com',shopify:'shopify.com',netlify:'netlify.com',vercel:'vercel.com',
  sentry:'sentry.io',datadog:'datadoghq.com',pagerduty:'pagerduty.com',
  salesforce:'salesforce.com',hubspot:'hubspot.com',mailchimp:'mailchimp.com',
  proton:'proton.me',bitwarden:'bitwarden.com',lastpass:'lastpass.com',
  '1password':'1password.com',dashlane:'dashlane.com',namecheap:'namecheap.com',
  godaddy:'godaddy.com',ovh:'ovh.com',linode:'linode.com',vultr:'vultr.com',
  hetzner:'hetzner.com',oracle:'oracle.com',ibm:'ibm.com',adobe:'adobe.com',
  snapchat:'snapchat.com',tiktok:'tiktok.com',pinterest:'pinterest.com',
  tumblr:'tumblr.com',spotify:'spotify.com',youtube:'youtube.com',
  nintendo:'nintendo.com',playstation:'playstation.com',xbox:'xbox.com',
  ubisoft:'ubisoft.com',roblox:'roblox.com',ea:'ea.com'
};

function resolveIconUrl(issuer, customUrl) {
  if (customUrl) return customUrl;
  const key = (issuer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [brand, domain] of Object.entries(ISSUER_DOMAINS)) {
    if (key.includes(brand)) return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  }
  if (key.length >= 2) return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(key + '.com') + '&sz=64';
  return null;
}

async function getSettings() {
  const { vaultSettings } = await browser.storage.local.get('vaultSettings');
  return { ...DEFAULT_SETTINGS, ...(vaultSettings || {}) };
}
async function saveSettings(s) {
  await browser.storage.local.set({ vaultSettings: s });
  sessionExpiresEnabled = !!s.sessionExpires;
}

// Load the cached session-expiry flag at startup
getSettings().then(s => { sessionExpiresEnabled = !!s.sessionExpires; });

function resetLockTimer() {
  clearTimeout(lockTimeout);
  // Only auto-lock on inactivity when the user has opted in to session expiry
  // and is not running a remembered session.
  if (sessionExpiresEnabled && !rememberSession) {
    lockTimeout = setTimeout(() => { cachedPassword = null; }, AUTO_LOCK_MS);
  }
}

function clearClipboardAfter(seconds) {
  clearTimeout(clipboardTimer);
  if (seconds > 0) clipboardTimer = setTimeout(() => {
    // Can't directly clear clipboard from background; send to active tab
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]) browser.tabs.sendMessage(tabs[0].id, { action: 'clearClipboard' }).catch(() => {});
    });
  }, seconds * 1000);
}

browser.contextMenus.removeAll().then(() => {
  browser.contextMenus.create({ id: 'autofill-otp', title: 'Autofill TOTP Code', contexts: ['editable'] });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'autofill-otp' || !cachedPassword) return;
  const accounts = await Vault.load(cachedPassword);
  const domain = new URL(tab.url).hostname;
  const match = accounts.find(a => (a.domains || []).some(d => domain === d || domain.endsWith('.' + d)));
  if (!match) return;
  const code = await TOTP.generate(match.secret, { period: match.period || 30, digits: match.digits || 6, algorithm: match.algorithm || 'SHA-1' });
  const settings = await getSettings();
  browser.tabs.sendMessage(tab.id, { action: 'fill', code, autoSubmit: !!settings.autoSubmit });
});

// Keyboard shortcut
browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'autofill-totp') return;
  if (!cachedPassword) return;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  const match = await findMatchForDomain(new URL(tabs[0].url).hostname);
  if (!match) return;
  const code = await TOTP.generate(match.secret, { period: match.period || 30, digits: match.digits || 6, algorithm: match.algorithm || 'SHA-1' });
  const settings = await getSettings();
  // Reset dismissed state so popup re-shows, then fill
  browser.tabs.sendMessage(tabs[0].id, { action: 'recheckDomain' }).catch(() => {});
  browser.tabs.sendMessage(tabs[0].id, { action: 'fill', code, autoSubmit: !!settings.autoSubmit }).catch(() => {});
});

function broadcastRecheck() {
  browser.tabs.query({}).then(tabs => {
    for (const tab of tabs) browser.tabs.sendMessage(tab.id, { action: 'recheckDomain' }).catch(() => {});
  });
}

async function findMatchForDomain(domain) {
  if (!cachedPassword) return null;
  const accounts = await Vault.load(cachedPassword);
  return accounts.find(a => (a.domains || []).some(d => domain === d || domain.endsWith('.' + d))) || null;
}

browser.runtime.onMessage.addListener((msg) => {
  try { return handleMessage(msg).catch(e => ({ ok: false, error: e.message })); }
  catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
});

async function handleMessage(msg) {
  switch (msg.action) {
    case 'unlock': {
      try {
        await Vault.load(msg.password);
        cachedPassword = msg.password;
        rememberSession = !!msg.remember;
        resetLockTimer();
        broadcastRecheck();
        return { ok: true };
      } catch (e) { return { ok: false, error: 'Wrong password' }; }
    }
    case 'lock':
      cachedPassword = null; rememberSession = false; clearTimeout(lockTimeout);
      return { ok: true };
    case 'getState':
      return { unlocked: !!cachedPassword, hasVault: await Vault.hasVault() };
    case 'getHint':
      return { hint: await Vault.getHint() };
    case 'getAccounts': {
      if (!cachedPassword) return { ok: false, error: 'Locked' };
      resetLockTimer();
      return { ok: true, accounts: await Vault.load(cachedPassword) };
    }
    case 'saveAccounts': {
      if (!cachedPassword) return { ok: false, error: 'Locked' };
      resetLockTimer();
      await Vault.save(cachedPassword, msg.accounts);
      return { ok: true };
    }
    case 'setPassword': {
      const accounts = cachedPassword ? await Vault.load(cachedPassword) : [];
      cachedPassword = msg.password;
      rememberSession = !!msg.remember;
      await Vault.save(msg.password, accounts);
      if (msg.hint !== undefined) await Vault.saveHint(msg.hint);
      resetLockTimer(); broadcastRecheck();
      return { ok: true };
    }
    case 'changePassword': {
      try {
        const accounts = await Vault.load(msg.currentPassword);
        cachedPassword = msg.newPassword;
        await Vault.save(msg.newPassword, accounts);
        if (msg.hint !== undefined) await Vault.saveHint(msg.hint);
        resetLockTimer();
        return { ok: true };
      } catch (e) { return { ok: false, error: 'Current password is incorrect' }; }
    }
    case 'generateOtp': {
      const code = await TOTP.generate(msg.secret, { period: msg.period || 30, digits: msg.digits || 6, algorithm: msg.algorithm || 'SHA-1' });
      return { code };
    }
    case 'matchDomain': {
      const settings = await getSettings();
      if (!settings.autofillEnabled) return { matched: false };
      const match = await findMatchForDomain(msg.domain);
      if (!match) return { matched: false };
      const code = await TOTP.generate(match.secret, { period: match.period || 30, digits: match.digits || 6, algorithm: match.algorithm || 'SHA-1' });
      const period = match.period || 30;
      const remaining = period - (Math.floor(Date.now() / 1000) % period);
      return { matched: true, code, issuer: match.issuer || 'TOTP', account: match.account || '', iconUrl: match.iconUrl || null, period, remaining, autoSubmit: !!settings.autoSubmit };
    }
    case 'autofillCurrent': {
      if (!cachedPassword) return { ok: false };
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) return { ok: false };
      const match = await findMatchForDomain(new URL(tabs[0].url).hostname);
      if (!match) return { ok: false, error: 'No matching account for this domain' };
      const code = await TOTP.generate(match.secret, { period: match.period || 30, digits: match.digits || 6, algorithm: match.algorithm || 'SHA-1' });
      const settings = await getSettings();
      browser.tabs.sendMessage(tabs[0].id, { action: 'fill', code, autoSubmit: !!settings.autoSubmit });
      return { ok: true };
    }
    // Settings
    case 'getSettings': return await getSettings();
    case 'saveSettings': { await saveSettings(msg.settings); resetLockTimer(); return { ok: true }; }
    // Export
    case 'exportVault': {
      if (!cachedPassword) return { ok: false, error: 'Locked' };
      const accounts = await Vault.load(cachedPassword);
      if (msg.encrypted) {
        const encrypted = await Vault.encrypt(msg.exportPassword || cachedPassword, accounts);
        return { ok: true, data: JSON.stringify({ encrypted: true, vault: encrypted }), filename: 'cyphr-encrypted.json' };
      }
      return { ok: true, data: JSON.stringify({ encrypted: false, accounts }, null, 2), filename: 'cyphr-plaintext.json' };
    }
    // Import
    case 'importVault': {
      if (!cachedPassword) return { ok: false, error: 'Locked' };
      try {
        const parsed = JSON.parse(msg.data);
        let imported;
        if (parsed.encrypted) {
          if (!msg.importPassword) return { ok: false, error: 'Password required for encrypted import' };
          try {
            imported = await Vault.decrypt(msg.importPassword, parsed.vault);
          } catch (decErr) {
            return { ok: false, error: 'Decryption failed — wrong password or corrupted file' };
          }
        } else {
          imported = parsed.accounts || parsed;
        }
        if (!Array.isArray(imported)) return { ok: false, error: 'Invalid format: expected an array of accounts' };
        const existing = await Vault.load(cachedPassword);
        const merged = msg.replace ? imported : [...existing, ...imported];
        await Vault.save(cachedPassword, merged);
        return { ok: true, count: imported.length };
      } catch (e) { return { ok: false, error: e.message || 'Import failed — invalid JSON file' }; }
    }
    // QR decode
    case 'decodeQR': {
      try {
        const result = jsQR(new Uint8ClampedArray(msg.data), msg.width, msg.height);
        if (result && result.data) return { ok: true, data: result.data };
        return { ok: false, error: 'No QR code found' };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    // Clipboard expiry
    case 'clipboardCopy': {
      const settings = await getSettings();
      if (settings.clipboardExpiry > 0) clearClipboardAfter(settings.clipboardExpiry);
      return { ok: true };
    }
    default: return { ok: false, error: 'Unknown action' };
  }
}
