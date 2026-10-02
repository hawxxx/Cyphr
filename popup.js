// Popup controller
const $ = s => document.querySelector(s);
let accounts = [];
let refreshInterval = null;

// ── Brand icon map: issuer → { color, letter/svg } ──
// Maps issuer keywords → domain for favicon lookup
const ISSUER_DOMAINS = {
  github:'github.com', google:'google.com', aws:'aws.amazon.com', amazon:'amazon.com',
  microsoft:'microsoft.com', azure:'azure.microsoft.com', apple:'apple.com',
  facebook:'facebook.com', meta:'meta.com', twitter:'twitter.com', x:'x.com',
  discord:'discord.com', slack:'slack.com', gitlab:'gitlab.com', bitbucket:'bitbucket.org',
  dropbox:'dropbox.com', stripe:'stripe.com', twilio:'twilio.com',
  cloudflare:'cloudflare.com', digitalocean:'digitalocean.com', heroku:'heroku.com',
  npm:'npmjs.com', docker:'docker.com', reddit:'reddit.com', linkedin:'linkedin.com',
  steam:'steampowered.com', epic:'epicgames.com', coinbase:'coinbase.com',
  binance:'binance.com', okta:'okta.com', auth0:'auth0.com', onelogin:'onelogin.com',
  zoom:'zoom.us', figma:'figma.com', notion:'notion.so', jira:'jira.atlassian.com',
  atlassian:'atlassian.com', twitch:'twitch.tv', nvidia:'nvidia.com',
  paypal:'paypal.com', shopify:'shopify.com', netlify:'netlify.com', vercel:'vercel.com',
  sentry:'sentry.io', datadog:'datadoghq.com', pagerduty:'pagerduty.com',
  salesforce:'salesforce.com', hubspot:'hubspot.com', mailchimp:'mailchimp.com',
  proton:'proton.me', bitwarden:'bitwarden.com', lastpass:'lastpass.com',
  '1password':'1password.com', dashlane:'dashlane.com', namecheap:'namecheap.com',
  godaddy:'godaddy.com', ovh:'ovh.com', linode:'linode.com', vultr:'vultr.com',
  hetzner:'hetzner.com', oracle:'oracle.com', ibm:'ibm.com', adobe:'adobe.com',
  snapchat:'snapchat.com', tiktok:'tiktok.com', pinterest:'pinterest.com',
  tumblr:'tumblr.com', spotify:'spotify.com', youtube:'youtube.com',
  nintendo:'nintendo.com', playstation:'playstation.com', xbox:'xbox.com',
  ubisoft:'ubisoft.com', roblox:'roblox.com', ea:'ea.com',
};

// ── Favicon cache ──
const faviconCache = {};
async function loadFaviconCache() {
  const { cachedFavicons } = await browser.storage.local.get('cachedFavicons');
  Object.assign(faviconCache, cachedFavicons || {});
}
function saveFaviconCache() {
  browser.storage.local.set({ cachedFavicons: faviconCache });
}
function cacheImg(el, domain) {
  el.addEventListener('load', () => {
    try {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      c.getContext('2d').drawImage(el, 0, 0, 64, 64);
      faviconCache[domain] = c.toDataURL('image/png');
      saveFaviconCache();
    } catch (e) {}
  }, { once: true });
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function initialFallback(issuer) {
  const letter = (issuer || '?')[0].toUpperCase();
  const hue = [...(issuer || '')].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return `<span style="background:hsl(${hue},55%,35%);color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:14px;font-weight:700">${letter}</span>`;
}

function getIssuerIcon(issuer, customIconUrl) {
  if (customIconUrl) return imgTag(customIconUrl, issuer, null);
  const key = (issuer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [brand, domain] of Object.entries(ISSUER_DOMAINS)) {
    if (key.includes(brand)) return imgTag(faviconUrl(domain), issuer, domain);
  }
  if (key.length >= 2) return imgTag(faviconUrl(key + '.com'), issuer, key + '.com');
  return initialFallback(issuer);
}

function imgTag(src, issuer, domain) {
  const id = domain ? `fav-${domain.replace(/[^a-z0-9]/g, '')}` : '';
  const cached = domain && faviconCache[domain];
  const useSrc = cached || src;
  const fallbackDirect = domain ? esc(`https://${domain}/favicon.ico`) : '';
  const fallbackInitials = encodeURIComponent(initialFallback(issuer));
  // Chain: src → /favicon.ico → initials
  const onerr = fallbackDirect
    ? `if(!this.dataset.tried){this.dataset.tried='1';this.src='${fallbackDirect}'}else{this.outerHTML=decodeURIComponent('${fallbackInitials}')}`
    : `this.outerHTML=decodeURIComponent('${fallbackInitials}')`;
  return `<img ${id ? `id="${id}"` : ''} data-domain="${esc(domain || '')}" src="${esc(useSrc)}" alt="" style="width:100%;height:100%;border-radius:8px;object-fit:contain" onerror="${onerr}">`;
}

// After render, attach cache listeners to issuer icons
function attachFaviconCaching() {
  document.querySelectorAll('.issuer-icon img[data-domain]').forEach(img => {
    if (img.dataset.domain) cacheImg(img, img.dataset.domain);
  });
}

function updateIconPreview(previewEl, issuer, urlInput) {
  const url = urlInput.value.trim();
  previewEl.innerHTML = getIssuerIcon(issuer, url || null);
}

// ── SVG icons ──
const SVG = {
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  zap: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  qrExport: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/></svg>',
};

// ── Views ──
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Domain Tags Component ──
function initDomainTags(wrapId, inputId) {
  const wrap = $(wrapId);
  const input = $(inputId);
  wrap.addEventListener('click', () => input.focus());

  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      addDomainTag(wrapId, inputId, input.value.trim().replace(/,/g, ''));
      input.value = '';
    }
    if (e.key === 'Backspace' && !input.value) {
      const tags = wrap.querySelectorAll('.dtag');
      if (tags.length) tags[tags.length - 1].remove();
    }
  });

  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      addDomainTag(wrapId, inputId, input.value.trim().replace(/,/g, ''));
      input.value = '';
    }
  });
}

function addDomainTag(wrapId, inputId, domain) {
  domain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) return;
  const wrap = $(wrapId);
  const input = $(inputId);
  // Prevent duplicates
  const existing = [...wrap.querySelectorAll('.dtag')].map(t => t.dataset.domain);
  if (existing.includes(domain)) return;

  const tag = document.createElement('span');
  tag.className = 'dtag';
  tag.dataset.domain = domain;
  tag.innerHTML = `${esc(domain)}<button class="dtag-x" title="Remove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  tag.querySelector('.dtag-x').addEventListener('click', e => { e.stopPropagation(); tag.remove(); });
  wrap.insertBefore(tag, input);
}

function getDomains(wrapId) {
  return [...$(wrapId).querySelectorAll('.dtag')].map(t => t.dataset.domain);
}

function setDomains(wrapId, inputId, domains) {
  const wrap = $(wrapId);
  wrap.querySelectorAll('.dtag').forEach(t => t.remove());
  (domains || []).forEach(d => addDomainTag(wrapId, inputId, d));
}

initDomainTags('#addDomainsWrap', '#addDomainInput');
initDomainTags('#editDomainsWrap', '#editDomainInput');

// ── Init ──
async function init() {
  await loadFaviconCache();
  try {
    const state = await browser.runtime.sendMessage({ action: 'getState' });

    if (state && state.unlocked) {
      await loadDashboard();
      if (window.location.hash === '#import') showView('#importView');
      await restoreFormState();
      return;
    }

    if (!state || !state.hasVault) {
      $('#lockTitle').textContent = 'Create Vault';
      $('#lockSubtitle').textContent = 'Set a master password to encrypt your TOTP secrets';
      $('#confirmGroup').style.display = 'block';
      $('#hintGroup').style.display = 'block';
      $('#unlockBtn').textContent = 'Create Vault';
      $('#rememberGroup').style.display = 'none';
      $('#hintDisplay').style.display = 'none';
    } else {
      $('#lockTitle').textContent = 'Unlock Vault';
      $('#lockSubtitle').textContent = 'Enter your master password';
      $('#confirmGroup').style.display = 'none';
      $('#hintGroup').style.display = 'none';
      $('#unlockBtn').textContent = 'Unlock';
      $('#rememberGroup').style.display = 'flex';
      try {
        const hintRes = await browser.runtime.sendMessage({ action: 'getHint' });
        if (hintRes && hintRes.hint) {
          $('#hintDisplay').textContent = 'Hint: ' + hintRes.hint;
          $('#hintDisplay').style.display = 'block';
        } else {
          $('#hintDisplay').style.display = 'none';
        }
      } catch (e) {
        $('#hintDisplay').style.display = 'none';
      }
    }

    showView('#lockView');
    $('#masterPassword').focus();
  } catch (e) {
    // If background is unavailable, still show lock screen
    showView('#lockView');
    $('#masterPassword').focus();
  }
}

// ── Unlock / Create ──
$('#unlockBtn').addEventListener('click', handleUnlock);
$('#masterPassword').addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
$('#confirmPassword').addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });

async function handleUnlock() {
  const pw = $('#masterPassword').value;
  if (!pw) return showError('Password required');
  const remember = $('#rememberCheck')?.checked || false;

  const state = await browser.runtime.sendMessage({ action: 'getState' });

  if (!state.hasVault) {
    const confirmVal = $('#confirmPassword').value;
    if (pw !== confirmVal) return showError('Passwords do not match');
    if (pw.length < 8) return showError('Minimum 8 characters');
    const hint = $('#hintInput').value.trim();
    await browser.runtime.sendMessage({ action: 'setPassword', password: pw, remember, hint });
  } else {
    const res = await browser.runtime.sendMessage({ action: 'unlock', password: pw, remember });
    if (!res.ok) return showError(res.error);
  }

  $('#masterPassword').value = '';
  $('#confirmPassword').value = '';
  $('#hintInput').value = '';
  await loadDashboard();
}

function showError(msg) {
  const el = $('#lockError');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Dashboard ──
async function loadDashboard() {
  showView('#dashView');
  const res = await browser.runtime.sendMessage({ action: 'getAccounts' });
  accounts = res.ok ? res.accounts : [];
  renderAccounts();
  startRefresh();
}

function startRefresh() {
  clearInterval(refreshInterval);
  refreshInterval = setInterval(updateCodes, 1000);
  updateCodes();
}

function renderAccounts() {
  const list = $('#accountsList');
  $('#accountCount').textContent = `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`;

  if (!accounts.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
      <p>No accounts yet.<br>Click + to add your first TOTP account.</p>
    </div>`;
    return;
  }

  list.innerHTML = accounts.map((a, i) => `
    <div class="account-card" data-index="${i}">
      <div class="account-top">
        <div class="account-left">
          <div class="issuer-icon">${getIssuerIcon(a.issuer, a.iconUrl)}</div>
          <div class="account-info">
            <h3>${esc(a.issuer || 'Unknown')}</h3>
            <span>${esc(a.account || '')}</span>
          </div>
        </div>
        <div class="account-actions">
          <button class="btn btn-icon btn-copy" data-index="${i}" title="Copy code">${SVG.copy}</button>
          <button class="btn btn-icon btn-autofill" data-index="${i}" title="Autofill">${SVG.zap}</button>
          <button class="btn btn-icon btn-edit" data-index="${i}" title="Edit">${SVG.edit}</button>
          <button class="btn btn-icon btn-qr-export" data-index="${i}" title="Export QR">${SVG.qrExport}</button>
        </div>
      </div>
      <div class="otp-display">
        <span class="otp-code" data-index="${i}" title="Click to copy">------</span>
        <svg class="countdown-ring" viewBox="0 0 40 40">
          <circle class="bg" cx="20" cy="20" r="17"/>
          <circle class="fg" cx="20" cy="20" r="17" data-index="${i}" stroke-dasharray="${2 * Math.PI * 17}" stroke-dashoffset="0"/>
          <text class="countdown-text" x="20" y="20" data-index="${i}">--</text>
        </svg>
      </div>
      ${(a.domains?.length) ? `<div class="domains-row">${a.domains.map(d => {
        const cached = faviconCache[d];
        const src = cached || `https://www.google.com/s2/favicons?domain=${esc(d)}&sz=32`;
        const direct = esc(`https://${d}/favicon.ico`);
        return `<span class="domain-tag"><img class="domain-favicon" data-domain="${esc(d)}" src="${esc(src)}" alt="" onerror="if(!this.dataset.tried){this.dataset.tried='1';this.src='${direct}'}else{this.style.display='none'}">${esc(d)}</span>`;
      }).join('')}</div>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('.btn-copy').forEach(b => b.addEventListener('click', e => copyCode(+e.currentTarget.dataset.index)));
  list.querySelectorAll('.btn-autofill').forEach(b => b.addEventListener('click', () => autofillCurrent()));
  list.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => openEdit(+e.currentTarget.dataset.index)));
  list.querySelectorAll('.btn-qr-export').forEach(b => b.addEventListener('click', e => openExportEntry(+e.currentTarget.dataset.index)));
  list.querySelectorAll('.otp-code').forEach(el => el.addEventListener('click', e => copyCode(+e.currentTarget.dataset.index)));
  attachFaviconCaching();
  document.querySelectorAll('.domain-favicon[data-domain]').forEach(img => {
    if (img.dataset.domain) cacheImg(img, img.dataset.domain);
  });
  updateCodes();
}

async function updateCodes() {
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const period = a.period || 30;
    const remaining = period - (Math.floor(Date.now() / 1000) % period);
    const fraction = remaining / period;
    const circ = 2 * Math.PI * 17;

    const code = await TOTP.generate(a.secret, { period, digits: a.digits || 6, algorithm: a.algorithm || 'SHA-1' });

    const codeEl = document.querySelector(`.otp-code[data-index="${i}"]`);
    const ringEl = document.querySelector(`.countdown-ring .fg[data-index="${i}"]`);
    const textEl = document.querySelector(`.countdown-text[data-index="${i}"]`);
    if (!codeEl) continue;

    const mid = Math.ceil(code.length / 2);
    codeEl.textContent = code.slice(0, mid) + ' ' + code.slice(mid);

    const cls = remaining <= 5 ? 'critical' : remaining <= 10 ? 'expiring' : '';
    codeEl.className = 'otp-code' + (cls ? ' ' + cls : '');
    ringEl.className.baseVal = 'fg' + (cls ? ' ' + cls : '');
    ringEl.style.strokeDashoffset = circ * (1 - fraction);
    textEl.textContent = remaining + 's';
  }
}

// ── Search ──
$('#searchInput').addEventListener('input', () => {
  const q = $('#searchInput').value.toLowerCase();
  document.querySelectorAll('.account-card').forEach(card => {
    const i = +card.dataset.index;
    const a = accounts[i];
    const match = !q || (a.issuer || '').toLowerCase().includes(q) || (a.account || '').toLowerCase().includes(q) || (a.domains || []).some(d => d.includes(q));
    card.style.display = match ? '' : 'none';
  });
});

// ── Settings ──
async function loadSettings() {
  const s = await browser.runtime.sendMessage({ action: 'getSettings' });
  $('#setAutofill').checked = s.autofillEnabled !== false;
  $('#setAutoCopy').checked = !!s.autoCopy;
  $('#setClipExpiry').value = String(s.clipboardExpiry || 30);
  $('#setAutoSubmit').checked = !!s.autoSubmit;
  $('#setSessionExpires').checked = !!s.sessionExpires;
}
async function saveSettings() {
  await browser.runtime.sendMessage({ action: 'saveSettings', settings: {
    autofillEnabled: $('#setAutofill').checked,
    autoCopy: $('#setAutoCopy').checked,
    clipboardExpiry: parseInt($('#setClipExpiry').value, 10),
    autoSubmit: $('#setAutoSubmit').checked,
    sessionExpires: $('#setSessionExpires').checked
  }});
}
$('#settingsBtn').addEventListener('click', async () => { await loadSettings(); showView('#settingsView'); });
$('#settingsBackBtn').addEventListener('click', async () => { await saveSettings(); showView('#dashView'); });
$('#setAutofill').addEventListener('change', saveSettings);
$('#setAutoCopy').addEventListener('change', saveSettings);
$('#setClipExpiry').addEventListener('change', saveSettings);
$('#setAutoSubmit').addEventListener('change', saveSettings);
$('#setSessionExpires').addEventListener('change', saveSettings);

// ── About ──
$('#aboutBtn').addEventListener('click', () => showView('#aboutView'));
$('#aboutBackBtn').addEventListener('click', () => showView('#settingsView'));

// ── Export ──
$('#exportBtn').addEventListener('click', () => showView('#exportView'));
$('#exportBackBtn').addEventListener('click', () => showView('#settingsView'));
$('#exportEncrypted').addEventListener('click', async () => {
  const res = await browser.runtime.sendMessage({ action: 'exportVault', encrypted: true });
  if (res.ok) downloadFile(res.data, res.filename, 'application/json');
  toast('Encrypted vault exported');
  showView('#dashView');
});
$('#exportPlaintext').addEventListener('click', async () => {
  if (!confirm('Export in plaintext? Your TOTP secrets will be visible to anyone with this file.')) return;
  const res = await browser.runtime.sendMessage({ action: 'exportVault', encrypted: false });
  if (res.ok) downloadFile(res.data, res.filename, 'application/json');
  toast('Plaintext vault exported');
  showView('#dashView');
});

function downloadFile(data, filename, type) {
  const blob = new Blob([data], { type });
  const reader = new FileReader();
  reader.onload = () => {
    browser.downloads.download({ url: reader.result, filename, saveAs: true });
  };
  reader.readAsDataURL(blob);
}

// ── Import ──
$('#importBtn').addEventListener('click', () => {
  $('#importText').value = ''; $('#importPassword').value = '';
  $('#importReplace').checked = false; $('#importError').style.display = 'none';
  $('#importPwGroup').style.display = 'none';
  showView('#importView');
});
$('#importBackBtn').addEventListener('click', () => showView('#settingsView'));
$('#importCancelBtn').addEventListener('click', () => showView('#settingsView'));

$('#importText').addEventListener('input', () => {
  const text = $('#importText').value.trim();
  if (!text) { $('#importPwGroup').style.display = 'none'; return; }
  try {
    const parsed = JSON.parse(text);
    $('#importPwGroup').style.display = parsed.encrypted ? 'block' : 'none';
  } catch (e) { $('#importPwGroup').style.display = 'none'; }
});

$('#importText').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; });
$('#importText').addEventListener('dragleave', e => { e.currentTarget.style.borderColor = 'var(--border)'; });
$('#importText').addEventListener('drop', e => {
  e.preventDefault();
  e.currentTarget.style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $('#importText').value = reader.result;
    $('#importText').dispatchEvent(new Event('input'));
  };
  reader.readAsText(file);
});

// File browse: if we're in a detached window/tab, use file input directly.
// If we're in the popup, reopen as a detached window first.
$('#importFile').addEventListener('click', (e) => {
  const isPopup = window.innerWidth < 500 && !window.location.hash;
  if (isPopup) {
    e.preventDefault();
    browser.windows.create({
      url: browser.runtime.getURL('popup.html#import'),
      type: 'popup',
      width: 420,
      height: 520
    });
    window.close();
  }
});

$('#importFile').addEventListener('change', () => {
  const file = $('#importFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $('#importText').value = reader.result;
    $('#importText').dispatchEvent(new Event('input'));
  };
  reader.readAsText(file);
});

$('#importDoBtn').addEventListener('click', async () => {
  const text = $('#importText').value.trim();
  if (!text) return showImportError('Paste vault JSON or drag a file here');
  try {
    const res = await browser.runtime.sendMessage({
      action: 'importVault', data: text,
      importPassword: $('#importPassword').value,
      replace: $('#importReplace').checked
    });
    if (!res || !res.ok) return showImportError((res && res.error) || 'Import failed');
    toast(`Imported ${res.count} account${res.count !== 1 ? 's' : ''}`);
    await loadDashboard();
  } catch (e) {
    showImportError(e.message || 'Import failed');
  }
});
function showImportError(msg) { const el = $('#importError'); el.textContent = msg; el.style.display = 'block'; }

// ── QR Scanner ──
let qrStream = null;
let qrAnimFrame = null;
let qrParsedUrl = null;

$('#qrScanBtn').addEventListener('click', async () => {
  qrParsedUrl = null;
  $('#qrResult').style.display = 'none';
  $('#qrAddBtn').style.display = 'none';
  $('#qrFileInput').value = '';
  showView('#qrView');
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('#qrVideo');
    video.srcObject = qrStream;
    video.play();
    scanQRFrame();
  } catch (e) { /* camera not available, user can upload image */ }
});

function stopQRScanner() {
  cancelAnimationFrame(qrAnimFrame);
  if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  $('#qrVideo').srcObject = null;
}

$('#qrBackBtn').addEventListener('click', () => { stopQRScanner(); showView('#settingsView'); });
$('#qrCancelBtn').addEventListener('click', () => { stopQRScanner(); showView('#settingsView'); });

function scanQRFrame() {
  const video = $('#qrVideo');
  const canvas = $('#qrCanvas');
  if (video.readyState !== video.HAVE_ENOUGH_DATA) { qrAnimFrame = requestAnimationFrame(scanQRFrame); return; }
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  browser.runtime.sendMessage({ action: 'decodeQR', data: Array.from(imageData.data), width: canvas.width, height: canvas.height }).then(res => {
    if (res.ok) { handleQRResult(res.data); stopQRScanner(); }
    else qrAnimFrame = requestAnimationFrame(scanQRFrame);
  });
}

$('#qrFileInput').addEventListener('change', () => {
  const file = $('#qrFileInput').files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const canvas = $('#qrCanvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    browser.runtime.sendMessage({ action: 'decodeQR', data: Array.from(imageData.data), width: canvas.width, height: canvas.height }).then(res => {
      if (res.ok) handleQRResult(res.data);
      else toast('No QR code found in image');
    });
  };
  img.src = URL.createObjectURL(file);
});

function handleQRResult(data) {
  $('#qrResult').textContent = data;
  $('#qrResult').style.display = 'block';
  if (data.startsWith('otpauth://')) {
    try {
      qrParsedUrl = TOTP.parseOtpauthUrl(data);
      $('#qrAddBtn').style.display = '';
    } catch (e) { toast('Invalid otpauth URL'); }
  }
}

$('#qrAddBtn').addEventListener('click', async () => {
  if (!qrParsedUrl) return;
  const p = qrParsedUrl;
  accounts.push({
    issuer: p.issuer, account: p.account, secret: p.secret,
    iconUrl: null, domains: [],
    period: p.period || 30, digits: p.digits || 6,
    algorithm: p.algorithm || 'SHA-1'
  });
  await browser.runtime.sendMessage({ action: 'saveAccounts', accounts });
  stopQRScanner();
  toast('Account added from QR');
  await loadDashboard();
});

// ── Auto-copy on code generation ──
async function copyCode(index) {
  const a = accounts[index];
  const res = await browser.runtime.sendMessage({
    action: 'generateOtp', secret: a.secret, period: a.period || 30, digits: a.digits || 6, algorithm: a.algorithm || 'SHA-1'
  });
  await navigator.clipboard.writeText(res.code);
  browser.runtime.sendMessage({ action: 'clipboardCopy' });
  toast('Copied to clipboard');
}

async function autofillCurrent() {
  const res = await browser.runtime.sendMessage({ action: 'autofillCurrent' });
  if (res.ok) { toast('Code autofilled'); window.close(); }
  else toast(res.error || 'No matching account for this site');
}

// ── Paste buttons ──
document.querySelectorAll('.btn-paste').forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    try {
      const text = await navigator.clipboard.readText();
      target.value = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      toast('Pasted from clipboard');
    } catch (e) {
      toast('Clipboard access denied');
    }
  });
});

// ── Form state persistence ──
// Saves form state so the popup can restore after closing (e.g. to copy a URL)
function saveFormState() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  const id = active.id;
  if (id === 'addView') {
    browser.storage.local.set({ _formState: { view: 'add', otpauthUrl: $('#otpauthUrl').value, issuer: $('#addIssuer').value, account: $('#addAccount').value, secret: $('#addSecret').value, iconUrl: $('#addIconUrl').value, domains: getDomains('#addDomainsWrap') }});
  } else if (id === 'editView') {
    browser.storage.local.set({ _formState: { view: 'edit', index: +$('#editIndex').value, issuer: $('#editIssuer').value, account: $('#editAccount').value, iconUrl: $('#editIconUrl').value, domains: getDomains('#editDomainsWrap') }});
  } else {
    browser.storage.local.remove('_formState');
  }
}

async function restoreFormState() {
  const { _formState: s } = await browser.storage.local.get('_formState');
  if (!s) return false;
  if (s.view === 'add') {
    showView('#addView');
    $('#otpauthUrl').value = s.otpauthUrl || '';
    $('#addIssuer').value = s.issuer || '';
    $('#addAccount').value = s.account || '';
    $('#addSecret').value = s.secret || '';
    $('#addIconUrl').value = s.iconUrl || '';
    setDomains('#addDomainsWrap', '#addDomainInput', s.domains || []);
    updateIconPreview($('#addIconPreview'), s.issuer || '', $('#addIconUrl'));
    return true;
  } else if (s.view === 'edit' && s.index < accounts.length) {
    showView('#editView');
    $('#editIndex').value = s.index;
    $('#editIssuer').value = s.issuer || '';
    $('#editAccount').value = s.account || '';
    $('#editIconUrl').value = s.iconUrl || '';
    setDomains('#editDomainsWrap', '#editDomainInput', s.domains || []);
    updateIconPreview($('#editIconPreview'), s.issuer || '', $('#editIconUrl'));
    return true;
  }
  return false;
}

function clearFormState() {
  browser.storage.local.remove('_formState');
}

// Auto-save form state on any input change in add/edit views
document.addEventListener('input', () => saveFormState());
document.addEventListener('click', (e) => {
  if (e.target.closest('.dtag-x')) setTimeout(saveFormState, 50);
});

// ── Add Account ──
$('#addBtn').addEventListener('click', () => {
  showView('#addView');
  $('#otpauthUrl').value = '';
  $('#addIssuer').value = '';
  $('#addAccount').value = '';
  $('#addSecret').value = '';
  $('#addIconUrl').value = '';
  setDomains('#addDomainsWrap', '#addDomainInput', []);
  updateIconPreview($('#addIconPreview'), '', $('#addIconUrl'));
});
$('#addBackBtn').addEventListener('click', () => { clearFormState(); showView('#dashView'); });
$('#addCancelBtn').addEventListener('click', () => { clearFormState(); showView('#dashView'); });

$('#addIssuer').addEventListener('input', () => updateIconPreview($('#addIconPreview'), $('#addIssuer').value, $('#addIconUrl')));
$('#addIconUrl').addEventListener('input', () => updateIconPreview($('#addIconPreview'), $('#addIssuer').value, $('#addIconUrl')));

$('#otpauthUrl').addEventListener('input', () => {
  const val = $('#otpauthUrl').value.trim();
  if (!val.startsWith('otpauth://')) return;
  try {
    const p = TOTP.parseOtpauthUrl(val);
    $('#addIssuer').value = p.issuer;
    $('#addAccount').value = p.account;
    $('#addSecret').value = p.secret;
    updateIconPreview($('#addIconPreview'), p.issuer, $('#addIconUrl'));
  } catch {}
});

$('#addSaveBtn').addEventListener('click', async () => {
  const secret = $('#addSecret').value.trim().replace(/\s/g, '');
  if (!secret) return toast('Secret is required');

  const newAccount = {
    issuer: $('#addIssuer').value.trim(),
    account: $('#addAccount').value.trim(),
    secret,
    iconUrl: $('#addIconUrl').value.trim() || null,
    domains: getDomains('#addDomainsWrap'),
    period: 30, digits: 6, algorithm: 'SHA-1'
  };

  const url = $('#otpauthUrl').value.trim();
  if (url.startsWith('otpauth://')) {
    try {
      const p = TOTP.parseOtpauthUrl(url);
      newAccount.period = p.period;
      newAccount.digits = p.digits;
      newAccount.algorithm = p.algorithm || 'SHA-1';
    } catch {}
  }

  accounts.push(newAccount);
  await browser.runtime.sendMessage({ action: 'saveAccounts', accounts });
  clearFormState();
  showView('#dashView');
  renderAccounts();
  toast('Account added');
});

// ── Edit Account ──
function openEdit(index) {
  const a = accounts[index];
  $('#editIssuer').value = a.issuer || '';
  $('#editAccount').value = a.account || '';
  $('#editIconUrl').value = a.iconUrl || '';
  $('#editIndex').value = index;
  setDomains('#editDomainsWrap', '#editDomainInput', a.domains);
  updateIconPreview($('#editIconPreview'), a.issuer, $('#editIconUrl'));
  showView('#editView');
}
$('#editBackBtn').addEventListener('click', () => { clearFormState(); showView('#dashView'); });
$('#editCancelBtn').addEventListener('click', () => { clearFormState(); showView('#dashView'); });
$('#editIssuer').addEventListener('input', () => updateIconPreview($('#editIconPreview'), $('#editIssuer').value, $('#editIconUrl')));
$('#editIconUrl').addEventListener('input', () => updateIconPreview($('#editIconPreview'), $('#editIssuer').value, $('#editIconUrl')));

$('#editSaveBtn').addEventListener('click', async () => {
  const i = +$('#editIndex').value;
  accounts[i].issuer = $('#editIssuer').value.trim();
  accounts[i].account = $('#editAccount').value.trim();
  accounts[i].iconUrl = $('#editIconUrl').value.trim() || null;
  accounts[i].domains = getDomains('#editDomainsWrap');
  await browser.runtime.sendMessage({ action: 'saveAccounts', accounts });
  clearFormState();
  showView('#dashView');
  renderAccounts();
  toast('Account updated');
});

$('#editDeleteBtn').addEventListener('click', async () => {
  if (!confirm('Delete this account? This cannot be undone.')) return;
  accounts.splice(+$('#editIndex').value, 1);
  await browser.runtime.sendMessage({ action: 'saveAccounts', accounts });
  clearFormState();
  showView('#dashView');
  renderAccounts();
  toast('Account deleted');
});

// ── Change Password ──
$('#changePwBtn').addEventListener('click', () => {
  showView('#changePwView');
  $('#cpCurrent').value = ''; $('#cpNew').value = ''; $('#cpConfirm').value = ''; $('#cpHint').value = '';
  $('#cpError').style.display = 'none';
});
$('#changePwBackBtn').addEventListener('click', () => showView('#settingsView'));
$('#cpCancelBtn').addEventListener('click', () => showView('#settingsView'));

$('#cpSaveBtn').addEventListener('click', async () => {
  const current = $('#cpCurrent').value;
  const newPw = $('#cpNew').value;
  const confirmPw = $('#cpConfirm').value;
  const hint = $('#cpHint').value.trim();

  if (!current || !newPw) { showCpError('All fields required'); return; }
  if (newPw.length < 8) { showCpError('New password must be at least 8 characters'); return; }
  if (newPw !== confirmPw) { showCpError('New passwords do not match'); return; }

  try {
    const res = await browser.runtime.sendMessage({ action: 'changePassword', currentPassword: current, newPassword: newPw, hint });
    if (!res || !res.ok) { showCpError(res?.error || 'Failed to change password'); return; }
    showView('#settingsView');
    toast('Master password changed');
  } catch (e) {
    showCpError('Error: ' + e.message);
  }
});

function showCpError(msg) {
  const el = $('#cpError');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Export Entry (QR) ──
function buildOtpauthUrl(a) {
  const alg = (a.algorithm || 'SHA-1').replace('-', '');
  const label = encodeURIComponent((a.issuer || '') + (a.account ? ':' + a.account : ''));
  let url = `otpauth://totp/${label}?secret=${encodeURIComponent(a.secret)}`;
  if (a.issuer) url += `&issuer=${encodeURIComponent(a.issuer)}`;
  if (alg !== 'SHA1') url += `&algorithm=${alg}`;
  if (a.digits && a.digits !== 6) url += `&digits=${a.digits}`;
  if (a.period && a.period !== 30) url += `&period=${a.period}`;
  return url;
}
function openExportEntry(index) {
  const a = accounts[index];
  const url = buildOtpauthUrl(a);
  $('#exportEntryTitle').textContent = a.issuer || 'Export Account';
  $('#exportEntryUrl').value = url;
  const container = $('#exportEntryQR');
  container.innerHTML = '';
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  container.innerHTML = qr.createSvgTag(4, 0);
  showView('#exportEntryView');
}
$('#exportEntryBackBtn').addEventListener('click', () => showView('#dashView'));
$('#exportEntryCopyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('#exportEntryUrl').value);
  toast('URL copied to clipboard');
});

// ── Lock ──
$('#lockBtn').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'lock' });
  clearInterval(refreshInterval);
  accounts = [];
  $('#masterPassword').value = '';
  $('#lockError').style.display = 'none';
  init();
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

init();
