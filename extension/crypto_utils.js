// SecureVault Crypto Utils for Extension
'use strict';

const CryptoUtils = (() => {
  const AUTH_HASH = 'SHA-256';
  const AUTH_ITERATIONS = 200000;

  function base64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  async function importKeyMaterial(password) {
    return crypto.subtle.importKey(
      'raw',
      strToBytes(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
  }

  async function deriveAuthHash(masterPassword, saltBase64) {
    try {
      const keyMaterial = await importKeyMaterial(masterPassword);
      const userSaltBytes = new Uint8Array(base64ToBuf(saltBase64));
      
      // Concaténation robuste du sel et du séparateur
      const separator = strToBytes('auth_salt_separator');
      const authSaltInput = new Uint8Array(userSaltBytes.length + separator.length);
      authSaltInput.set(userSaltBytes);
      authSaltInput.set(separator, userSaltBytes.length);

      const authSaltBuffer = await crypto.subtle.digest(AUTH_HASH, authSaltInput);
      const authSalt = new Uint8Array(authSaltBuffer).slice(0, 16);

      const bits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: authSalt,
          iterations: AUTH_ITERATIONS,
          hash: AUTH_HASH,
        },
        keyMaterial,
        256
      );

      return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.error("Erreur interne de dérivation:", e);
      throw new Error("Erreur de dérivation cryptographique.");
    }
  }

  return { deriveAuthHash };
})();
