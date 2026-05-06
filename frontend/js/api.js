/**
 * SecureVault API Client
 * Handles all communication with the backend
 */

'use strict';

const API = (() => {
  const BASE = '/api';

  async function request(method, path, body = null) {
    const opts = {
      method,
      credentials: 'include', // send cookies
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data.error || data.errors?.[0]?.msg || 'Erreur réseau');
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async function getSalt(email) {
    return request('POST', '/auth/salt', { email });
  }

  async function register(email, passwordHash, salt) {
    return request('POST', '/auth/register', { email, passwordHash, salt });
  }

  async function login(email, passwordHash) {
    return request('POST', '/auth/login', { email, passwordHash });
  }

  async function logout() {
    return request('POST', '/auth/logout');
  }

  async function getMe() {
    return request('GET', '/auth/me');
  }

  // ─── Vault ────────────────────────────────────────────────────────────────

  async function getVault() {
    return request('GET', '/vault');
  }

  async function createItem(item) {
    return request('POST', '/vault', item);
  }

  async function updateItem(id, item) {
    return request('PUT', `/vault/${id}`, item);
  }

  async function deleteItem(id) {
    return request('DELETE', `/vault/${id}`);
  }

  async function getFolders() {
    return request('GET', '/vault/folders/list');
  }

  async function createFolder(name_enc) {
    return request('POST', '/vault/folders/create', { name_enc });
  }

  return {
    getSalt,
    register,
    login,
    logout,
    getMe,
    getVault,
    createItem,
    updateItem,
    deleteItem,
    getFolders,
    createFolder,
  };
})();
