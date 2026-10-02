// Content script: auto-detect whitelisted domains, show inline OTP popup, autofill
(() => {
  const POPUP_ID = 'cyphr-otp-inline-popup';
  let refreshTimer = null;
  let currentField = null;
  let popupShown = false;
  let matchData = null; // cached domain match result

  // ── OTP field detection (very broad) ──
  const OTP_RE = /otp|totp|2fa|two.?factor|auth.?code|security.?code|one.?time|mfa|passcode|pin.?code|verification.?code|verify.?code|enter.?code|digit.?code|6.?digit|confirm.?code|ecom.?token/i;
  const EXCLUDE_RE = /username|user.?name|user.?id|email|e-mail|login|password|passwd|phone|mobile|first.?name|last.?name|address|search|coupon|promo|zip|postal/i;

  function getFieldContext(el) {
    const parts = [el.name, el.id, el.placeholder, el.autocomplete,
      el.getAttribute('aria-label'), el.title, el.className,
      el.getAttribute('data-testid'), el.getAttribute('data-name')].filter(Boolean);

    // Associated <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) parts.push(label.textContent);
    }
    // Parent <label>
    const parentLabel = el.closest('label');
    if (parentLabel) parts.push(parentLabel.textContent);

    // Nearby text: walk up to 3 levels and grab text
    let node = el;
    for (let i = 0; i < 3 && node.parentElement; i++) {
      node = node.parentElement;
      // Get direct text content of parent (not deep children)
      for (const child of node.childNodes) {
        if (child === el || child.contains?.(el)) continue;
        if (child.nodeType === 3 && child.textContent.trim()) parts.push(child.textContent);
        if (child.nodeType === 1 && (child.tagName === 'LABEL' || child.tagName === 'SPAN' || child.tagName === 'P' || child.tagName === 'DIV'))
          parts.push(child.textContent);
      }
    }

    return parts.join(' ').toLowerCase();
  }

  function isLikelyOtpField(el) {
    if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'submit' ||
        el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return false;

    const directCtx = [el.name, el.id, el.placeholder, el.autocomplete, el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();

    // Password/email fields only allowed if they look OTP-related.
    // A positive OTP signal anywhere — the field's own attributes OR its
    // associated label / nearby prompt text — qualifies it. This catches masked
    // challenge inputs like CyberArk's RADIUS field, whose aria-label is generic
    // ("Enter your answer"), whose autocomplete="new-password" would otherwise
    // trip the exclude filter, and whose only real signal is a sibling prompt
    // ("Enter your security code:"). The real account password/email field never
    // matches because no OTP keyword appears anywhere in its context.
    if (el.type === 'password' || el.type === 'email') {
      if (OTP_RE.test(directCtx)) return true;
      return OTP_RE.test(getFieldContext(el));
    }

    // Exclude fields that are clearly not OTP
    if (EXCLUDE_RE.test(directCtx)) return false;

    const ctx = getFieldContext(el);
    if (OTP_RE.test(ctx)) return true;

    // Short numeric-style inputs
    const ml = el.maxLength;
    if ((el.type === 'tel' || el.type === 'number' || el.inputMode === 'numeric') &&
        ml >= 4 && ml <= 8) return true;
    if (matchData && (el.type === 'text' || el.type === 'tel' || el.type === 'number' || el.type === '') &&
        ml >= 4 && ml <= 8) return true;

    return false;
  }

  function findOtpFields() {
    return Array.from(document.querySelectorAll('input')).filter(isLikelyOtpField);
  }

  function findSplitOtpFields() {
    // Look for groups of single-char inputs
    const allInputs = document.querySelectorAll('input');
    const singles = Array.from(allInputs).filter(i =>
      !i.disabled && !i.readOnly && i.type !== 'hidden' &&
      (i.maxLength === 1 || (i.size === 1 && i.maxLength <= 2))
    );
    if (singles.length >= 4 && singles.length <= 8) return singles;

    // Also check inside containers
    const groups = document.querySelectorAll('[class*="otp"], [class*="code"], [class*="verify"], [class*="pin"], [data-testid*="otp"], [data-testid*="code"]');
    for (const group of groups) {
      const inputs = group.querySelectorAll('input');
      if (inputs.length >= 4 && inputs.length <= 8) return Array.from(inputs);
    }
    return null;
  }

  function findAnyTarget() {
    const split = findSplitOtpFields();
    if (split) return split[0];
    const fields = findOtpFields();
    if (fields.length) return fields[0];
    // Last resort on matched domain: any visible text input that isn't username/password/email
    if (matchData) {
      const all = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])');
      for (const el of all) {
        if (el.disabled || el.readOnly || el.offsetParent === null) continue;
        if (el.type === 'password' || el.type === 'email') continue;
        const directCtx = [el.name, el.id, el.placeholder, el.autocomplete, el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
        if (EXCLUDE_RE.test(directCtx)) continue;
        return el;
      }
    }
    return null;
  }

  function fillCode(code, autoSubmit) {
    const splitFields = findSplitOtpFields();
    if (splitFields && splitFields.length === code.length) {
      splitFields.forEach((input, i) => {
        setNativeValue(input, code[i]);
      });
      if (autoSubmit) submitForm(splitFields[0]);
      return true;
    }
    const target = currentField || findOtpFields()[0] || findAnyTarget();
    if (target) {
      target.focus();
      setNativeValue(target, code);
      if (autoSubmit) submitForm(target);
      return true;
    }
    return false;
  }

  function submitForm(field) {
    setTimeout(() => {
      const form = field.closest('form');
      if (form) {
        const btn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])');
        if (btn) btn.click();
        else form.requestSubmit ? form.requestSubmit() : form.submit();
        return;
      }
      // No form — try pressing Enter on the field
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }, 300);
  }

  // Set value using native setter to trigger React/Angular/Vue change detection
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // Also dispatch keyboard events for frameworks that listen to those
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // ── Inline popup ──
  function createPopup() {
    if (document.getElementById(POPUP_ID)) return document.getElementById(POPUP_ID);
    const host = document.createElement('div');
    host.id = POPUP_ID;
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .otp-popup { position:fixed; z-index:2147483647; background:#151821; border:1px solid #2a2f42; border-radius:12px; padding:12px 14px; box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(0,212,170,0.1); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#e4e6f0; min-width:260px; display:none; top:16px; right:16px; left:auto; }
        .otp-popup.entering { animation:popIn .3s cubic-bezier(.175,.885,.32,1.275) forwards; }
        .otp-popup.exiting { animation:popOut .2s ease-in forwards; }
        @keyframes popIn { from{opacity:0;transform:translateY(-12px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes popOut { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(-12px) scale(.95)} }
        .otp-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .otp-brand { display:flex; align-items:center; gap:6px; }
        .otp-brand svg { color:#00d4aa; }
        .otp-brand span { font-size:11px; font-weight:600; color:#8b90a5; letter-spacing:.3px; }
        .otp-close { width:20px; height:20px; background:none; border:none; color:#8b90a5; cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:4px; }
        .otp-close:hover { background:#262b3d; color:#e4e6f0; }
        .otp-issuer { font-size:13px; font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
        .otp-issuer-icon { width:32px; height:32px; border-radius:6px; flex-shrink:0; display:inline-block; overflow:hidden; }
        .otp-issuer-icon img { width:100%; height:100%; border-radius:6px; object-fit:contain; }
        .otp-row { display:flex; align-items:center; gap:10px; background:#1c2030; border:1px solid #262b3d; border-radius:8px; padding:8px 12px; cursor:pointer; transition:border-color .15s; }
        .otp-row:hover { border-color:#00d4aa; }
        .otp-code-text { font-family:'SF Mono','Fira Code',Consolas,monospace; font-size:22px; font-weight:700; letter-spacing:3px; color:#00d4aa; flex:1; }
        .otp-code-text.expiring { color:#ffc857; }
        .otp-code-text.critical { color:#ff6b6b; }
        .timer-ring { width:28px; height:28px; }
        .timer-ring .bg { fill:none; stroke:#262b3d; stroke-width:3; }
        .timer-ring .fg { fill:none; stroke:#00d4aa; stroke-width:3; stroke-linecap:round; transform:rotate(-90deg); transform-origin:center; transition:stroke-dashoffset 1s linear,stroke .3s; }
        .timer-ring .fg.expiring { stroke:#ffc857; }
        .timer-ring .fg.critical { stroke:#ff6b6b; }
        .timer-text { font-family:'SF Mono',monospace; font-size:9px; fill:#8b90a5; text-anchor:middle; dominant-baseline:central; }
        .otp-actions { display:flex; gap:4px; margin-top:8px; }
        .otp-btn { flex:1; padding:6px 0; border:1px solid #262b3d; border-radius:6px; background:#1c2030; color:#8b90a5; font-size:11px; font-weight:600; font-family:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; transition:all .15s; }
        .otp-btn:hover { background:#262b3d; color:#e4e6f0; }
        .otp-btn.primary { background:#00d4aa; color:#0c0e14; border-color:#00d4aa; }
        .otp-btn.primary:hover { background:#00b894; }
        .otp-btn svg { width:12px; height:12px; }
      </style>
      <div class="otp-popup">
        <div class="otp-header">
          <div class="otp-brand">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>CYPHR TOTP</span>
          </div>
          <button class="otp-close" id="otpClose"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="otp-issuer" id="otpIssuer"><span class="otp-issuer-icon" id="otpIcon"><img id="otpIconImg" src="" alt="" style="display:none"></span><span id="otpIssuerText"></span></div>
        <div class="otp-row" id="otpRow" title="Click to copy">
          <span class="otp-code-text" id="otpCode">------</span>
          <div class="otp-timer">
            <svg class="timer-ring" viewBox="0 0 28 28">
              <circle class="bg" cx="14" cy="14" r="11"/>
              <circle class="fg" id="timerFg" cx="14" cy="14" r="11" stroke-dasharray="${2 * Math.PI * 11}" stroke-dashoffset="0"/>
              <text class="timer-text" x="14" y="14" id="timerText">--</text>
            </svg>
          </div>
        </div>
        <div class="otp-actions">
          <button class="otp-btn primary" id="otpFill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Autofill</button>
          <button class="otp-btn" id="otpCopy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</button>
        </div>
      </div>`;

    document.documentElement.appendChild(host);
    const root = shadow.querySelector('.otp-popup');
    shadow.getElementById('otpClose').addEventListener('click', () => hidePopup('permanent'));
    shadow.getElementById('otpRow').addEventListener('click', () => doCopy(shadow));
    shadow.getElementById('otpCopy').addEventListener('click', () => doCopy(shadow));
    shadow.getElementById('otpFill').addEventListener('click', () => {
      const code = shadow.getElementById('otpCode').textContent.replace(/\s/g, '');
      fillCode(code, matchData && matchData.autoSubmit);
      hidePopup('temp');
    });
    host._shadow = shadow;
    host._root = root;
    return host;
  }

  function doCopy(shadow) {
    const code = shadow.getElementById('otpCode').textContent.replace(/\s/g, '');
    navigator.clipboard.writeText(code).catch(() => {});
    const btn = shadow.getElementById('otpCopy');
    btn.textContent = 'Copied';
    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy'; }, 1500);
  }

  function positionPopup(el) {
    const root = el._root;
    root.style.display = 'block';
    root.classList.remove('exiting');
    root.classList.add('entering');
  }

  let dismissed = false;
  let dismissTimer = null;

  function hidePopup(mode) {
    // mode: 'temp' = allow re-show after 2s, 'permanent' = stay hidden until recheckDomain
    const el = document.getElementById(POPUP_ID);
    if (!el || !el._root) return;
    const root = el._root;
    if (root.style.display === 'none' && !popupShown) return;

    popupShown = false;
    clearInterval(refreshTimer);
    clearTimeout(dismissTimer);

    if (mode === 'permanent') {
      dismissed = true;
    } else {
      dismissed = true;
      dismissTimer = setTimeout(() => { dismissed = false; }, 2000);
    }

    root.classList.remove('entering');
    root.classList.add('exiting');
    root.addEventListener('animationend', () => {
      root.style.display = 'none';
      root.classList.remove('exiting');
    }, { once: true });
  }

  async function showPopup(field, data) {
    popupShown = true;
    const el = createPopup();
    const shadow = el._shadow;
    currentField = field;
    shadow.getElementById('otpIssuerText').textContent = data.issuer;
    // Show favicon for issuer
    const key = (data.issuer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let iconSrc = data.iconUrl;
    if (!iconSrc) {
      iconSrc = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(key + '.com') + '&sz=64';
    }
    const iconImg = shadow.getElementById('otpIconImg');
    iconImg.src = iconSrc;
    iconImg.style.display = '';
    iconImg.onerror = () => { iconImg.style.display = 'none'; };
    positionPopup(el);
    updatePopupCode(shadow, data.code, data.period, data.remaining);

    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      try {
        const res = await browser.runtime.sendMessage({ action: 'matchDomain', domain: location.hostname });
        if (res && res.matched) updatePopupCode(shadow, res.code, res.period, res.remaining);
      } catch (e) { clearInterval(refreshTimer); }
    }, 1000);
  }

  function updatePopupCode(shadow, code, period, remaining) {
    const codeEl = shadow.getElementById('otpCode');
    const ringEl = shadow.getElementById('timerFg');
    const textEl = shadow.getElementById('timerText');
    const mid = Math.ceil(code.length / 2);
    codeEl.textContent = code.slice(0, mid) + ' ' + code.slice(mid);
    const cls = remaining <= 5 ? 'critical' : remaining <= 10 ? 'expiring' : '';
    codeEl.className = 'otp-code-text' + (cls ? ' ' + cls : '');
    ringEl.className.baseVal = 'fg' + (cls ? ' ' + cls : '');
    ringEl.style.strokeDashoffset = (2 * Math.PI * 11) * (1 - remaining / period);
    textEl.textContent = remaining + 's';
  }

  // ── Domain matching ──
  async function fetchMatch() {
    try {
      const res = await browser.runtime.sendMessage({ action: 'matchDomain', domain: location.hostname });
      if (res && res.matched) { matchData = res; return res; }
    } catch (e) {}
    matchData = null;
    return null;
  }

  // Show popup anchored to a field, or if no field found, show it fixed at bottom-right
  async function tryShowPopup() {
    if (popupShown) return true;
    const data = matchData || await fetchMatch();
    if (!data) return false;

    const target = findAnyTarget();
    if (target) {
      await showPopup(target, data);
      // Also auto-fill immediately
      const code = data.code;
      fillCode(code, data.autoSubmit);
      return true;
    }
    return false;
  }

  // ── Initialization: check domain immediately ──
  async function init() {
    const data = await fetchMatch();
    if (!data) return;

    // Retry finding fields for up to 15 seconds
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const shown = await tryShowPopup();
      if (shown || attempts > 30) clearInterval(interval);
    }, 500);

    // Also try immediately
    tryShowPopup();
  }

  init();

  // Re-check when any input gets focused
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    if (dismissed && !e.target.value) dismissed = false;
    if (popupShown || dismissed) return;
    // Skip excluded fields
    const dc = [e.target.name, e.target.id, e.target.placeholder, e.target.autocomplete, e.target.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
    if (EXCLUDE_RE.test(dc) && !OTP_RE.test(dc)) return;
    if (matchData) {
      currentField = e.target;
      showPopup(e.target, matchData);
      fillCode(matchData.code, matchData.autoSubmit);
    } else {
      fetchMatch().then(data => {
        if (data) {
          currentField = e.target;
          showPopup(e.target, data);
          fillCode(data.code, data.autoSubmit);
        }
      });
    }
  });

  // Periodic re-check (catches unlock-after-navigate)
  let recheckCount = 0;
  const recheckInterval = setInterval(async () => {
    if (popupShown) { clearInterval(recheckInterval); return; }
    const data = await fetchMatch();
    if (data) {
      await tryShowPopup();
      recheckCount++;
    }
    recheckCount++;
    if (recheckCount > 40) clearInterval(recheckInterval);
  }, 3000);

  // Watch for dynamically added fields
  if (document.body) {
    const observer = new MutationObserver(() => {
      if (!popupShown && matchData) tryShowPopup();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Close on click outside or Escape
  document.addEventListener('click', (e) => {
    if (!popupShown) return;
    const popup = document.getElementById(POPUP_ID);
    if (popup && !popup.contains(e.target) && e.target !== currentField) hidePopup('temp');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popupShown) hidePopup('permanent'); });

  // Listen for messages from background
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'fill' && msg.code) fillCode(msg.code, msg.autoSubmit);
    if (msg.action === 'clearClipboard') navigator.clipboard.writeText('').catch(() => {});
    if (msg.action === 'recheckDomain') {
      popupShown = false;
      dismissed = false;
      clearTimeout(dismissTimer);
      matchData = null;
      init();
    }
  });
})();
