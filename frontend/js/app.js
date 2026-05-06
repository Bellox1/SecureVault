/**
 * SecureVault - Application Logic
 * Zero-Knowledge Password Manager
 */

'use strict';

const App = (() => {

  // ─── State ──────────────────────────────────────────────────────────────────
  let encryptionKey = null;     // CryptoKey — never persisted, only in memory
  let vaultItems = [];          // Decrypted vault items (in memory only)
  let currentUser = null;
  let currentFilter = 'all';
  let currentSearch = '';
  let editingItemId = null;
  let autoLockTimer = null;
  const AUTO_LOCK_MINUTES = 15;

  // ─── DOM Helpers ────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const hideEl = el => { if (el) el.style.display = 'none'; };
  const showEl = (el, display = 'block') => { if (el) el.style.display = display; };

  function showToast(msg, type = 'info') {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
    t.innerHTML = `<span class="toast-icon"><i data-lucide="${icon}" style="width:18px"></i></span><span>${msg}</span>`;
    $('toast-container').appendChild(t);
    lucide.createIcons({ props: { "stroke-width": 2.5 } });
    setTimeout(() => {
      t.style.animation = 'toast-out 0.3s ease forwards';
      setTimeout(() => t.remove(), 300);
    }, 4000);
  }

  // ─── Auto-lock ──────────────────────────────────────────────────────────────
  function resetAutoLock() {
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => {
      lock('Session expirée après inactivité.');
    }, AUTO_LOCK_MINUTES * 60 * 1000);
  }

  function lock(reason = 'Coffre verrouillé.') {
    encryptionKey = null;
    vaultItems = [];
    sessionStorage.clear();
    showToast(reason, 'warning');
    setTimeout(() => { window.location.href = '/'; }, 1500);
  }

  ['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, resetAutoLock, { passive: true })
  );

  // ─── Initialization ──────────────────────────────────────────────────────────
  async function init() {
    // 1. Verify session
    try {
      const res = await API.getMe();
      currentUser = res.user;
    } catch {
      window.location.href = '/';
      return;
    }

    // 2. Derive encryption key from master password (held temporarily in sessionStorage)
    const tmpMp = sessionStorage.getItem('sv_tmp_mp');
    const salt = sessionStorage.getItem('sv_salt');

    if (!tmpMp || !salt) {
      // User refreshed without master password — must re-login
      showToast('Veuillez vous reconnecter pour déchiffrer votre coffre.', 'warning');
      setTimeout(() => { window.location.href = '/'; }, 2000);
      return;
    }

    try {
      encryptionKey = await Crypto.deriveEncryptionKey(tmpMp, salt);
    } catch {
      showToast('Erreur de dérivation de clé. Reconnectez-vous.', 'error');
      setTimeout(() => { window.location.href = '/'; }, 2000);
      return;
    } finally {
      // CRITICAL: Clear master password from sessionStorage immediately
      sessionStorage.removeItem('sv_tmp_mp');
    }

    // 3. Setup UI
    setupUI();
    resetAutoLock();

    // 4. Load vault
    await loadVault();

    // 5. Hide loading screen
    hideEl($('loading-screen'));
  }

  // ─── Setup UI ───────────────────────────────────────────────────────────────
  function setupUI() {
    // User info
    const emailShort = currentUser.email.split('@')[0];
    $('user-email-display').textContent = currentUser.email;
    $('user-avatar-initials').textContent = emailShort.slice(0, 2).toUpperCase();

    // Nav items
    document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        currentFilter = item.dataset.filter;
        currentSearch = '';
        $('search-input').value = '';
        renderVault();
      });
    });

    // Search
    $('search-input').addEventListener('input', (e) => {
      currentSearch = e.target.value.toLowerCase();
      renderVault();
    });

    // Add item button
    $('add-item-btn').addEventListener('click', () => openItemModal(null));
    $('add-item-topbar').addEventListener('click', () => openItemModal(null));

    // Logout
    $('logout-btn').addEventListener('click', async () => {
      try { await API.logout(); } catch {}
      encryptionKey = null;
      sessionStorage.clear();
      window.location.href = '/';
    });

    // Lock vault
    $('lock-btn')?.addEventListener('click', () => lock('Coffre verrouillé manuellement.'));

    // Modal close buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => closeAllModals());
    });

    // Modal overlay click to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAllModals();
      });
    });

    // Item form submission
    $('item-form').addEventListener('submit', saveItem);

    // Password generator in modal
    $('gen-password-btn').addEventListener('click', generateAndFill);
    $('gen-refresh-btn').addEventListener('click', generateAndFill);
    $('gen-length').addEventListener('input', (e) => {
      $('gen-length-val').textContent = e.target.value;
      generateAndFill();
    });

    // Copy buttons in view modal
    $('view-copy-user').addEventListener('click', () => {
      const val = $('view-username-val').textContent;
      if (val && val !== '—') copyToClipboard(val, 'Nom d\'utilisateur copié');
    });
    $('view-copy-pass').addEventListener('click', () => {
      const val = $('view-password-val').dataset.raw;
      if (val) copyToClipboard(val, 'Mot de passe copié');
    });
    $('view-copy-url').addEventListener('click', () => {
      const val = $('view-url-val').textContent;
      if (val && val !== '—') copyToClipboard(val, 'URL copiée');
    });
    $('view-toggle-pass').addEventListener('click', () => {
      const el = $('view-password-val');
      const raw = el.dataset.raw;
      if (!raw) return;
      if (el.textContent === '••••••••') {
        el.textContent = raw;
        $('view-toggle-pass').innerHTML = '<i data-lucide="eye-off"></i>';
      } else {
        el.textContent = '••••••••';
        $('view-toggle-pass').innerHTML = '<i data-lucide="eye"></i>';
      }
      lucide.createIcons();
    });
    $('view-edit-btn').addEventListener('click', () => {
      const id = $('view-modal').dataset.itemId;
      closeAllModals();
      if (id) openItemModal(id);
    });
    $('view-delete-btn').addEventListener('click', () => {
      const id = $('view-modal').dataset.itemId;
      if (id) confirmDeleteItem(id);
    });

    // Delete confirmation
    $('delete-confirm-btn').addEventListener('click', async () => {
      const id = $('delete-modal').dataset.itemId;
      if (id) await deleteItem(id);
    });

    // Password strength in item form
    $('item-password').addEventListener('input', (e) => {
      const { score, label, color } = Crypto.checkPasswordStrength(e.target.value);
      const pct = Math.min(100, (score / 9) * 100);
      $('item-strength-fill').style.width = `${pct}%`;
      $('item-strength-fill').style.background = color;
      $('item-strength-label').textContent = e.target.value ? `${label}` : '';
      $('item-strength-label').style.color = color;
    });

    // Item type tabs
    document.querySelectorAll('.type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        updateFormForType(tab.dataset.type);
      });
    });

    // Toggle password visibility in form
    $('toggle-item-pass').addEventListener('click', () => {
      const inp = $('item-password');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      $('toggle-item-pass').innerHTML = `<i data-lucide="${inp.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
      lucide.createIcons();
    });
  }

  // ─── Load Vault ─────────────────────────────────────────────────────────────
  async function loadVault() {
    try {
      showEl($('vault-loading'));
      const { items } = await API.getVault();

      // Decrypt all items in parallel
      vaultItems = await Promise.all(
        items.map(item => Crypto.decryptVaultItem(item, encryptionKey))
      );

      renderVault();
      updateStats();
    } catch (err) {
      showToast('Erreur lors du chargement du coffre.', 'error');
      console.error(err);
    } finally {
      hideEl($('vault-loading'));
    }
  }

  // ─── Render Vault ───────────────────────────────────────────────────────────
  function renderVault() {
    const grid = $('vault-grid');
    grid.innerHTML = '';

    let filtered = vaultItems.filter(item => {
      if (item.decryptionError) return true;
      const matchesFilter =
        currentFilter === 'all' ||
        currentFilter === 'favorites' && item.favorite ||
        item.type === currentFilter;
      const matchesSearch =
        !currentSearch ||
        item.name?.toLowerCase().includes(currentSearch) ||
        item.username?.toLowerCase().includes(currentSearch) ||
        item.url?.toLowerCase().includes(currentSearch);
      return matchesFilter && matchesSearch;
    });

    // Update badge counts
    updateNavBadges();

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon"><i data-lucide="shield-off" style="width:64px;height:64px"></i></div>
          <h3>${currentSearch ? 'Aucun résultat' : 'Coffre vide'}</h3>
          <p>${currentSearch ? `Aucun élément ne correspond à "${currentSearch}"` : 'Ajoutez votre premier élément sécurisé.'}</p>
          ${!currentSearch ? `<button class="btn btn-primary" onclick="App.openItemModal(null)"><i data-lucide="plus" style="width:18px;margin-right:8px"></i> Ajouter un élément</button>` : ''}
        </div>
      `;
      lucide.createIcons();
      return;
    }

    filtered.forEach(item => {
      const card = createVaultCard(item);
      grid.appendChild(card);
    });
  }

  function createVaultCard(item) {
    const icons = { login: 'key', card: 'credit-card', note: 'sticky-note', identity: 'user' };
    
    const card = document.createElement('article');
    card.className = 'vault-item fade-in';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.id = item.id;

    const strength = item.password ? Crypto.checkPasswordStrength(item.password) : null;
    const strengthIndicator = strength && strength.score <= 4 
      ? `<span style="color: #ef4444; font-size: 0.7rem; font-weight: 700; margin-left: 8px">Faible</span>`
      : '';

    card.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 1rem">
        <div style="width: 40px; height: 40px; background: var(--bw-blue-nude); color: var(--bw-primary); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0">
          <i data-lucide="${icons[item.type] || 'key'}" style="width: 20px; height: 20px"></i>
        </div>
        <div style="flex: 1; min-width: 0">
          <div style="font-weight: 700; font-size: 0.9375rem; margin-bottom: 0.125rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 0.5rem">
            ${escapeHtml(item.name || 'Sans titre')}
            ${item.favorite ? '<i data-lucide="star" style="width:12px; height:12px; fill: #FBBF24; color: #FBBF24"></i>' : ''}
          </div>
          <div style="font-size: 0.8125rem; color: var(--bw-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
            ${item.username ? escapeHtml(item.username) : (item.url ? escapeHtml(item.url) : 'Aucun identifiant')}
            ${strengthIndicator}
          </div>
        </div>
        <div style="display: flex; gap: 0.25rem">
          <button class="btn btn-ghost btn-sm" style="padding: 0.4rem; border-radius: 6px" data-action="copy" title="Copier"><i data-lucide="copy" style="width:16px"></i></button>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'copy') {
        e.stopPropagation();
        if (item.password) copyToClipboard(item.password, 'Mot de passe copié');
        else showToast('Aucun mot de passe à copier.', 'info');
      } else {
        openViewModal(item);
      }
      lucide.createIcons();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openViewModal(item);
      }
    });

    return card;
  }

  // ─── View Modal ─────────────────────────────────────────────────────────────
  function openViewModal(item) {
    $('view-modal').dataset.itemId = item.id;
    $('view-item-name').textContent = item.name || 'Sans titre';
    $('view-username-val').textContent = item.username || '—';
    $('view-password-val').textContent = item.password ? '••••••••' : '—';
    $('view-password-val').dataset.raw = item.password || '';
    $('view-url-val').textContent = item.url || '—';
    $('view-notes-val').textContent = item.notes || '—';
    $('view-toggle-pass').style.display = item.password ? '' : 'none';
    $('view-copy-pass').style.display = item.password ? '' : 'none';

    // Show/hide URL as link
    const urlEl = $('view-url-val');
    if (item.url) {
      const a = document.createElement('a');
      a.href = item.url.startsWith('http') ? item.url : `https://${item.url}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.url;
      urlEl.textContent = '';
      urlEl.appendChild(a);
    } else {
      urlEl.textContent = '—';
    }

    const overlay = $('view-modal-overlay');
    showEl(overlay, 'flex');
  }

  // ─── Item Modal (Create / Edit) ──────────────────────────────────────────────
  function openItemModal(itemId) {
    editingItemId = itemId;
    const item = itemId ? vaultItems.find(v => v.id === itemId) : null;

    $('item-modal-title').textContent = item ? 'Modifier l\'élément' : 'Nouvel élément';
    $('item-form').reset();
    $('item-strength-fill').style.width = '0%';
    $('item-strength-label').textContent = '';

    // Reset tabs
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    const defaultType = item?.type || 'login';
    document.querySelector(`.type-tab[data-type="${defaultType}"]`)?.classList.add('active');
    updateFormForType(defaultType);

    if (item) {
      $('item-name').value = item.name || '';
      $('item-username').value = item.username || '';
      $('item-password').value = item.password || '';
      $('item-url').value = item.url || '';
      $('item-notes').value = item.notes || '';
      $('item-favorite').checked = item.favorite || false;

      if (item.password) {
        const { score, label, color } = Crypto.checkPasswordStrength(item.password);
        const pct = Math.min(100, (score / 9) * 100);
        $('item-strength-fill').style.width = `${pct}%`;
        $('item-strength-fill').style.background = color;
        $('item-strength-label').textContent = label;
        $('item-strength-label').style.color = color;
      }
    }

    // Generate a password suggestion for new items
    if (!item) {
      generateAndFill();
    }

    lucide.createIcons();
    showEl($('item-modal-overlay'), 'flex');
  }

  function updateFormForType(type) {
    const loginFields = $('login-fields');
    const cardFields  = $('card-fields');
    if (type === 'login' || type === 'note' || type === 'identity') {
      showEl(loginFields);
      hideEl(cardFields);
    } else if (type === 'card') {
      hideEl(loginFields);
      showEl(cardFields);
    }
  }

  function closeAllModals() {
    ['view-modal-overlay', 'item-modal-overlay', 'delete-modal-overlay', 'gen-modal-overlay'].forEach(id => {
      const el = $(id);
      if (el) hideEl(el);
    });
    editingItemId = null;
  }

  // ─── Save Item ───────────────────────────────────────────────────────────────
  async function saveItem(e) {
    e.preventDefault();
    const btn = $('save-item-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    const type = document.querySelector('.type-tab.active')?.dataset.type || 'login';

    const plainItem = {
      type,
      name: $('item-name').value.trim(),
      username: $('item-username')?.value.trim() || '',
      password: $('item-password')?.value || '',
      url: $('item-url')?.value.trim() || '',
      notes: $('item-notes')?.value.trim() || '',
      favorite: $('item-favorite')?.checked || false,
    };

    if (!plainItem.name) {
      showToast('Le nom est requis.', 'error');
      btn.classList.remove('loading');
      btn.disabled = false;
      return;
    }

    try {
      // Encrypt the item client-side
      const encrypted = await Crypto.encryptVaultItem(plainItem, encryptionKey);

      if (editingItemId) {
        await API.updateItem(editingItemId, encrypted);
        const idx = vaultItems.findIndex(v => v.id === editingItemId);
        if (idx !== -1) vaultItems[idx] = { id: editingItemId, ...plainItem };
        showToast('Élément mis à jour.', 'success');
      } else {
        const result = await API.createItem(encrypted);
        vaultItems.unshift({ id: result.id, ...plainItem, created_at: Date.now(), updated_at: Date.now() });
        showToast('Élément ajouté au coffre.', 'success');
      }

      closeAllModals();
      renderVault();
      updateStats();
    } catch (err) {
      showToast(err.message || 'Erreur lors de la sauvegarde.', 'error');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  // ─── Delete Item ─────────────────────────────────────────────────────────────
  function confirmDeleteItem(id) {
    const item = vaultItems.find(v => v.id === id);
    $('delete-item-name').textContent = item?.name || 'cet élément';
    $('delete-modal').dataset.itemId = id;
    closeAllModals();
    showEl($('delete-modal-overlay'), 'flex');
  }

  async function deleteItem(id) {
    const btn = $('delete-confirm-btn');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      await API.deleteItem(id);
      vaultItems = vaultItems.filter(v => v.id !== id);
      closeAllModals();
      renderVault();
      updateStats();
      showToast('Élément supprimé.', 'success');
    } catch (err) {
      showToast(err.message || 'Erreur lors de la suppression.', 'error');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  // ─── Password Generator ──────────────────────────────────────────────────────
  function generateAndFill() {
    const length = parseInt($('gen-length')?.value || 20);
    const opts = {
      length,
      uppercase: $('gen-upper')?.checked ?? true,
      lowercase: $('gen-lower')?.checked ?? true,
      numbers: $('gen-nums')?.checked ?? true,
      symbols: $('gen-syms')?.checked ?? true,
      excludeAmbiguous: $('gen-no-ambig')?.checked ?? true,
    };

    try {
      const pwd = Crypto.generatePassword(opts);
      $('gen-password-preview').textContent = pwd;
      // Fill into item form if open
      const pwdInput = $('item-password');
      if (pwdInput) {
        pwdInput.value = pwd;
        pwdInput.dispatchEvent(new Event('input'));
      }
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────
  function updateStats() {
    $('stat-total').textContent   = vaultItems.length;
    $('stat-logins').textContent  = vaultItems.filter(v => v.type === 'login').length;
    $('stat-weak').textContent    = vaultItems.filter(v => v.password && Crypto.checkPasswordStrength(v.password).score <= 4).length;
    $('stat-favs').textContent    = vaultItems.filter(v => v.favorite).length;
  }

  function updateNavBadges() {
    const total = vaultItems.length;
    const badge = document.querySelector('.nav-item[data-filter="all"] .nav-badge');
    if (badge) badge.textContent = total;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────
  async function copyToClipboard(text, successMsg = 'Copié !') {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMsg, 'success');
      // Auto-clear clipboard after 30 seconds
      setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === text) {
            await navigator.clipboard.writeText('');
          }
        } catch {}
      }, 30000);
    } catch {
      showToast('Impossible d\'accéder au presse-papiers.', 'error');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Auto-init Lucide observer for dynamically added elements (optional but good)
  // Instead, we call createIcons after renders.

  // ─── Public Interface ────────────────────────────────────────────────────────
  return {
    init,
    openItemModal,
    openViewModal,
    copyToClipboard,
    generateAndFill,
  };
})();

// Start app
document.addEventListener('DOMContentLoaded', () => {
    App.init();
    lucide.createIcons();
});
