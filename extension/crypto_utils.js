// SecureVault Crypto Utils for Extension
'use strict';

const CryptoUtils = (() => {
  const KDF_HASH = 'SHA-512';
  const AUTH_HASH = 'SHA-256';
  const ENC_ALGO = 'AES-GCM';
  const ENC_KEY_LENGTH = 256;
  const IV_LENGTH = 12;
  const DEFAULT_ITERATIONS = 600000;
  const AUTH_ITERATIONS = 200000;

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

  function generateIV() {
    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);
    return iv;
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
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function deriveAuthHash(masterPassword, saltBase64) {
    const keyMaterial = await importKeyMaterial(masterPassword);
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
      256
    );

    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function encrypt(plaintext, encryptionKey) {
    const iv = generateIV();
    const encodedData = strToBytes(typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext));

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: ENC_ALGO, iv },
      encryptionKey,
      encodedData
    );

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

  async function encryptVaultItem(item, encryptionKey) {
    const { data_enc: nameEnc, iv: nameIv, auth_tag: nameTag } = await encrypt(item.name || '', encryptionKey);
    const payload = JSON.stringify({
      username: item.username || '',
      password: item.password || '',
      url: item.url || '',
      notes: item.notes || '',
      totp: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      customFields: [],
    });
    const { data_enc, iv, auth_tag } = await encrypt(payload, encryptionKey);

    return {
      type: item.type || 'login',
      name_enc: JSON.stringify({ c: nameEnc, iv: nameIv, t: nameTag }),
      data_enc,
      iv,
      auth_tag,
      favorite: false,
      folder_id: null,
    };
  }

  function generatePassword(length = 20) {
    const charset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()";
    let password = "";
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      password += charset.charAt(array[i] % charset.length);
    }
    return password;
  }

  return { 
    deriveAuthHash, 
    deriveEncryptionKey, 
    encryptVaultItem, 
    generatePassword 
  };
})();
