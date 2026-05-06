/**
 * SecureVault Crypto Module
 * Zero-Knowledge client-side encryption using Web Crypto API
 * 
 * Key Derivation:  PBKDF2-SHA512 (600,000 iterations)
 * Encryption:      AES-256-GCM
 * Auth Hash:       PBKDF2-SHA256 (separate derived key for authentication)
 */

'use strict';

const Crypto = (() => {
  // ─── Constants ──────────────────────────────────────────────────────────────
  const KDF_HASH = 'SHA-512';
  const AUTH_HASH = 'SHA-256';
  const ENC_ALGO = 'AES-GCM';
  const ENC_KEY_LENGTH = 256;
  const IV_LENGTH = 12; // 96-bit IV for GCM
  const DEFAULT_ITERATIONS = 600000;
  const AUTH_ITERATIONS = 200000;

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  function base64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToStr(buf) {
    return new TextDecoder().decode(buf);
  }

  function generateSalt(byteLength = 32) {
    const salt = new Uint8Array(byteLength);
    crypto.getRandomValues(salt);
    return bufToBase64(salt.buffer);
  }

  function generateIV() {
    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);
    return iv;
  }

  // ─── Key Derivation ───────────────────────────────────────────────────────────

  /**
   * Import master password as a PBKDF2 base key material
   */
  async function importKeyMaterial(password) {
    return crypto.subtle.importKey(
      'raw',
      strToBytes(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
  }

  /**
   * Derive an AES-256 encryption key from master password + salt
   * This key is used to encrypt/decrypt vault items
   * It is NEVER sent to the server
   */
  async function deriveEncryptionKey(masterPassword, saltBase64, iterations = DEFAULT_ITERATIONS) {
    const keyMaterial = await importKeyMaterial(masterPassword);
    const salt = new Uint8Array(base64ToBuf(saltBase64));

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: KDF_HASH,
      },
      keyMaterial,
      { name: ENC_ALGO, length: ENC_KEY_LENGTH },
      false, // not extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Derive an authentication hash from master password + salt
   * This is what gets sent to the server for verification
   * A DIFFERENT salt/iterations are used so the auth hash ≠ encryption key
   * 
   * The server receives this hash and re-hashes it with Argon2id,
   * providing defense-in-depth even if the client-side PBKDF2 is somehow weakened.
   */
  async function deriveAuthHash(masterPassword, saltBase64) {
    const keyMaterial = await importKeyMaterial(masterPassword);
    // Use a dedicated auth salt (derived from user's salt to avoid storing two salts)
    const userSaltBytes = new Uint8Array(base64ToBuf(saltBase64));
    const authSaltInput = new Uint8Array([...userSaltBytes, ...strToBytes('auth_salt_separator')]);
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
      256 // 32 bytes = 64 hex chars
    );

    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── Encryption / Decryption ──────────────────────────────────────────────────

  /**
   * Encrypt a string value using AES-256-GCM
   * Returns: { ciphertext, iv, authTag } all in base64
   * Note: GCM auth tag is appended by WebCrypto to ciphertext
   */
  async function encrypt(plaintext, encryptionKey) {
    const iv = generateIV();
    const encodedData = strToBytes(typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext));

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: ENC_ALGO, iv },
      encryptionKey,
      encodedData
    );

    // WebCrypto appends 16-byte auth tag at end of cipherBuffer
    const cipherArray = new Uint8Array(cipherBuffer);
    const tagOffset = cipherArray.length - 16;
    const ciphertext = cipherArray.slice(0, tagOffset);
    const authTag = cipherArray.slice(tagOffset);

    return {
      data_enc: bufToBase64(ciphertext.buffer),
      iv: bufToBase64(iv.buffer),
      auth_tag: bufToBase64(authTag.buffer),
    };
  }

  /**
   * Decrypt an AES-256-GCM encrypted payload
   */
  async function decrypt(data_enc, ivBase64, authTagBase64, encryptionKey) {
    const ciphertext = new Uint8Array(base64ToBuf(data_enc));
    const authTag = new Uint8Array(base64ToBuf(authTagBase64));
    const iv = new Uint8Array(base64ToBuf(ivBase64));

    // Reassemble ciphertext + auth tag (WebCrypto expects them concatenated)
    const fullCipher = new Uint8Array(ciphertext.length + authTag.length);
    fullCipher.set(ciphertext, 0);
    fullCipher.set(authTag, ciphertext.length);

    const plainBuffer = await crypto.subtle.decrypt(
      { name: ENC_ALGO, iv },
      encryptionKey,
      fullCipher
    );

    return bytesToStr(plainBuffer);
  }

  /**
   * Encrypt a vault item's name separately (for search/listing purposes)
   */
  async function encryptVaultItem(item, encryptionKey) {
    const { data_enc: nameEnc, iv: nameIv, auth_tag: nameTag } = await encrypt(item.name, encryptionKey);
    const payload = JSON.stringify({
      username: item.username || '',
      password: item.password || '',
      url: item.url || '',
      notes: item.notes || '',
      totp: item.totp || '',
      cardNumber: item.cardNumber || '',
      cardHolder: item.cardHolder || '',
      expiryDate: item.expiryDate || '',
      cvv: item.cvv || '',
      customFields: item.customFields || [],
    });
    const { data_enc, iv, auth_tag } = await encrypt(payload, encryptionKey);

    return {
      type: item.type || 'login',
      name_enc: JSON.stringify({ c: nameEnc, iv: nameIv, t: nameTag }),
      data_enc,
      iv,
      auth_tag,
      favorite: item.favorite || false,
      folder_id: item.folder_id || null,
    };
  }

  /**
   * Decrypt a vault item returned from the server
   */
  async function decryptVaultItem(encItem, encryptionKey) {
    try {
      // Decrypt name
      const namePayload = JSON.parse(encItem.name_enc);
      const decryptedName = await decrypt(namePayload.c, namePayload.iv, namePayload.t, encryptionKey);

      // Decrypt data payload
      const decryptedData = await decrypt(encItem.data_enc, encItem.iv, encItem.auth_tag, encryptionKey);
      const data = JSON.parse(decryptedData);

      return {
        id: encItem.id,
        type: encItem.type,
        name: decryptedName,
        favorite: !!encItem.favorite,
        folder_id: encItem.folder_id,
        created_at: encItem.created_at,
        updated_at: encItem.updated_at,
        ...data,
      };
    } catch (err) {
      console.error('Decryption failed for item', encItem.id, err);
      return {
        id: encItem.id,
        type: encItem.type,
        name: '[Erreur de déchiffrement]',
        decryptionError: true,
      };
    }
  }

  // ─── Password Generator ────────────────────────────────────────────────────────

  function generatePassword(options = {}) {
    const {
      length = 20,
      uppercase = true,
      lowercase = true,
      numbers = true,
      symbols = true,
      excludeAmbiguous = true,
    } = options;

    let charset = '';
    if (uppercase) charset += excludeAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (lowercase) charset += excludeAmbiguous ? 'abcdefghjkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
    if (numbers) charset += excludeAmbiguous ? '23456789' : '0123456789';
    if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (!charset) throw new Error('Au moins un type de caractère requis.');

    const values = new Uint32Array(length);
    crypto.getRandomValues(values);
    return Array.from(values, v => charset[v % charset.length]).join('');
  }

  // ─── Password Strength ────────────────────────────────────────────────────────

  function checkPasswordStrength(password) {
    if (!password) return { score: 0, label: 'Vide', color: '#666' };

    let score = 0;
    const checks = {
      length12: password.length >= 12,
      length16: password.length >= 16,
      length20: password.length >= 20,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      numbers: /[0-9]/.test(password),
      symbols: /[^A-Za-z0-9]/.test(password),
      noRepeat: !/(.)\1{2}/.test(password),
    };

    score += checks.length12 ? 1 : 0;
    score += checks.length16 ? 1 : 0;
    score += checks.length20 ? 1 : 0;
    score += checks.uppercase ? 1 : 0;
    score += checks.lowercase ? 1 : 0;
    score += checks.numbers ? 1 : 0;
    score += checks.symbols ? 2 : 0;
    score += checks.noRepeat ? 1 : 0;

    if (score <= 2) return { score, label: 'Très faible', color: '#ef4444' };
    if (score <= 4) return { score, label: 'Faible', color: '#f97316' };
    if (score <= 6) return { score, label: 'Moyen', color: '#eab308' };
    if (score <= 8) return { score, label: 'Fort', color: '#22c55e' };
    return { score, label: 'Très fort', color: '#10b981' };
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    generateSalt,
    deriveEncryptionKey,
    deriveAuthHash,
    encrypt,
    decrypt,
    encryptVaultItem,
    decryptVaultItem,
    generatePassword,
    checkPasswordStrength,
  };
})();
