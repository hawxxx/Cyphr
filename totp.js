// TOTP implementation per RFC 6238 using Web Crypto API (no dependencies)
const TOTP = (() => {
  function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    str = str.replace(/[\s=-]+/g, '').toUpperCase();
    let bits = '', bytes = [];
    for (const c of str) {
      const val = alphabet.indexOf(c);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }
    for (let i = 0; i + 8 <= bits.length; i += 8)
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return new Uint8Array(bytes);
  }

  async function hmacSha(algorithm, key, message) {
    const algo = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-512': 'SHA-512' }[algorithm] || 'SHA-1';
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algo }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
    return new Uint8Array(sig);
  }

  function intToBytes(num) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(4, num, false);
    return new Uint8Array(buf);
  }

  async function generate(secret, { period = 30, digits = 6, algorithm = 'SHA-1', timestamp = null } = {}) {
    const time = Math.floor((timestamp || Date.now()) / 1000);
    const counter = Math.floor(time / period);
    const key = base32Decode(secret);
    const msg = intToBytes(counter);
    const hash = await hmacSha(algorithm, key, msg);
    const offset = hash[hash.length - 1] & 0x0f;
    const binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
    const otp = (binary % Math.pow(10, digits)).toString().padStart(digits, '0');
    return otp;
  }

  function remaining(period = 30) {
    return period - (Math.floor(Date.now() / 1000) % period);
  }

  function parseOtpauthUrl(url) {
    const u = new URL(url);
    if (u.protocol !== 'otpauth:') throw new Error('Invalid otpauth URL');
    const type = u.hostname; // totp or hotp
    const label = decodeURIComponent(u.pathname.slice(1));
    const params = u.searchParams;
    const [issuer, account] = label.includes(':') ? label.split(':', 2) : [params.get('issuer') || '', label];
    return {
      type,
      secret: params.get('secret') || '',
      issuer: params.get('issuer') || issuer.trim(),
      account: account.trim(),
      algorithm: ((params.get('algorithm') || 'SHA1').toUpperCase()).replace(/^SHA(\d)/,'SHA-$1'),
      digits: parseInt(params.get('digits') || '6', 10),
      period: parseInt(params.get('period') || '30', 10)
    };
  }

  return { generate, remaining, parseOtpauthUrl, base32Decode };
})();

if (typeof module !== 'undefined') module.exports = TOTP;
