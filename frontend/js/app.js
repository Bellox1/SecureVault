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

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

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

  function lock(reason = 'Coffre verrouillé.') {
    encryptionKey = null;
    vaultItems = [];
    sessionStorage.clear();
    showToast(reason, 'warning');
    setTimeout(() => { window.location.href = '/'; }, 1500);
  }

  // ─── Initialization ──────────────────────────────────────────────────────────
  async function init() {
    // 1. Verify session
    try {
      const res = await API.getMe();
      currentUser = res.user;

      // Admin check
      if (currentUser.is_admin) {
        showEl($('admin-nav-section'), 'block');
      }
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
    }
    // Note: sv_tmp_mp is kept in sessionStorage to allow refreshes. 
    // It's cleared on explicit logout or when tab is closed.

    // 3. Setup UI
    setupUI();

    // 4. Load vault
    await loadVault();

    // 5. Hide loading screen and show app shell
    hideEl($('loading-screen'));
    showEl($('app-shell'), 'grid'); // Utilisation de grid pour correspondre au CSS
  }

  // ─── Setup UI ───────────────────────────────────────────────────────────────
  function setupUI() {
    // User info
    const emailShort = currentUser.email.split('@')[0];
    $('user-email-display').textContent = currentUser.email;
    $('user-avatar-initials').textContent = emailShort.slice(0, 2).toUpperCase();

    // ─── Global Add logic ───────────────────────────────────────────────────
    function handleGlobalAdd() {
      let defaultType = 'login';
      if (currentFilter === 'note') defaultType = 'note';
      openEditPane(null, defaultType);
    }

    // Nav items
    document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        currentFilter = item.dataset.filter;
        currentSearch = '';
        $('search-input').value = '';
        hideEl($('top-bar-back'));
        
        const categoryNames = {
          'all': 'Mon Coffre',
          'favorites': 'Favoris',
          'login': 'Identifiants',
          'note': 'Notes sécurisées'
        };
        const titleText = categoryNames[currentFilter] || 'Mon Coffre';
        $('top-bar-title').textContent = titleText;
        
        closeAllModals();
        
        // If clicking on a tab but top-bar-title is modified by closeAllModals, reset it!
        $('top-bar-title').textContent = titleText;

        renderVault();
      });
    });

    // Search
    $('search-input').addEventListener('input', (e) => {
      currentSearch = e.target.value.toLowerCase();
      renderVault();
    });

    // Add item buttons
    const addDashboardBtn = $('add-item-dashboard');
    if (addDashboardBtn) addDashboardBtn.addEventListener('click', handleGlobalAdd);
    
    const addTopbarBtn = $('add-item-topbar');
    if (addTopbarBtn) addTopbarBtn.addEventListener('click', handleGlobalAdd);

    const backBtn = $('top-bar-back');
    if (backBtn) backBtn.addEventListener('click', closeAllModals);
    const sidebarAddBtn = $('nav-add-item-sidebar');
    if (sidebarAddBtn) sidebarAddBtn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      sidebarAddBtn.classList.add('active');
      openEditPane(null);
    });

    // Standalone Generator button
    $('open-generator').addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      $('open-generator').classList.add('active');
      openGeneratorView();
    });

    // Lock vault (now calls full logout for simplicity)
    $('lock-btn')?.addEventListener('click', window.handleLogout);

    $('nav-admin').onclick = () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      $('nav-admin').classList.add('active');
      openAdminView();
    };
    
    $('refresh-logs-btn').onclick = () => loadAdminLogs('combined', 'admin-logs-viewer');
    $('refresh-error-logs-btn').onclick = () => loadAdminLogs('error', 'admin-error-logs-viewer');

    $('tab-log-activity').onclick = () => {
      $('tab-log-activity').classList.add('active');
      $('tab-log-error').classList.remove('active');
      showEl($('pane-log-activity'), 'block');
      hideEl($('pane-log-error'));
      loadAdminLogs('combined', 'admin-logs-viewer');
    };

    $('tab-log-error').onclick = () => {
      $('tab-log-error').classList.add('active');
      $('tab-log-activity').classList.remove('active');
      showEl($('pane-log-error'), 'block');
      hideEl($('pane-log-activity'));
      loadAdminLogs('error', 'admin-error-logs-viewer');
    };

    $('clear-logs-btn').onclick = async () => {
      if (!confirm('Êtes-vous sûr de vouloir vider tous les fichiers de logs ? Cette action est irréversible.')) return;
      
      try {
        await API.clearAdminLogs();
        showToast('Logs vidés.');
        loadAdminLogs('combined', 'admin-logs-viewer');
        loadAdminLogs('error', 'admin-error-logs-viewer');
      } catch (err) {
        showToast(`Erreur: ${err.message || 'Impossible de vider les logs'}`, 'error');
      }
    };

    // Modal close buttons
    document.querySelectorAll('.modal-cancel, .modal-close').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });
    
    const cancelItemBtn = $('cancel-item-btn');
    if (cancelItemBtn) cancelItemBtn.addEventListener('click', closeAllModals);

    ['delete-modal-overlay', 'gen-modal-overlay'].forEach(id => {
      const overlay = $(id);
      if (!overlay) return;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAllModals();
      });
    });

    // Item form submission
    $('item-form').addEventListener('submit', saveItem);

    // Password generator in item form
    $('gen-password-btn').addEventListener('click', generateAndFill);
    $('gen-refresh-btn').addEventListener('click', generateAndFill);
    $('gen-length').addEventListener('input', (e) => {
      $('gen-length-val').textContent = e.target.value;
      generateAndFill();
    });
    ['gen-upper', 'gen-lower', 'gen-nums', 'gen-syms', 'gen-no-ambig'].forEach(id => {
      $(id).addEventListener('change', generateAndFill);
    });

    // Settings view
    $('open-settings').addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      $('open-settings').classList.add('active');
      openSettingsView();
    });

    $('setup-2fa-btn').onclick = handle2FASetup;
    $('confirm-2fa-btn').onclick = handle2FAEnable;
    $('disable-2fa-btn').onclick = handle2FADisable;
    $('change-password-form').onsubmit = handleChangeMasterPassword;
    $('new-master-password').oninput = (e) => {
      const strength = Crypto.checkPasswordStrength(e.target.value);
      const bar = $('new-password-strength-bar');
      bar.style.width = (strength.score * 11) + '%';
      bar.style.background = strength.color;
    };

    ['toggle-current-pass', 'toggle-new-pass'].forEach(id => {
      const btn = $(id);
      if (!btn) return;
      btn.onclick = () => {
        const inputId = id === 'toggle-current-pass' ? 'current-master-password' : 'new-master-password';
        const inp = $(inputId);
        inp.type = inp.type === 'password' ? 'text' : 'password';
        btn.innerHTML = `<i data-lucide="${inp.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
        lucide.createIcons();
      };
    });

    // Tool Generator Events
    const toolGenRefreshBtn = $('tool-gen-refresh-btn');
    if (toolGenRefreshBtn) toolGenRefreshBtn.addEventListener('click', generateForTool);
    
    const toolGenLength = $('tool-gen-length');
    if (toolGenLength) toolGenLength.addEventListener('input', (e) => {
      $('tool-gen-length-val').textContent = e.target.value;
      generateForTool();
    });
    ['tool-gen-upper', 'tool-gen-lower', 'tool-gen-nums', 'tool-gen-syms', 'tool-gen-no-ambig']
      .forEach(id => $(id).addEventListener('change', generateForTool));

    $('tool-gen-copy-btn').addEventListener('click', () => {
      copyToClipboard($('tool-gen-password-preview').textContent, 'Mot de passe copié');
    });

    // Export Events
    $('export-json-btn').addEventListener('click', exportAsJSON);
    $('export-csv-btn').addEventListener('click', exportAsCSV);
    $('export-pdf-btn').addEventListener('click', exportAsPDF);

    // Import Events
    $('import-vault-btn').addEventListener('click', () => $('import-file-input').click());
    $('import-file-input').addEventListener('change', handleImportFile);

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
    $('view-copy-notes').addEventListener('click', () => {
      const val = $('view-notes-val').textContent;
      if (val && val !== '—') copyToClipboard(val, 'Note copiée');
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
      const id = $('view-details').dataset.itemId;
      openEditPane(id);
    });
    $('view-delete-btn').addEventListener('click', () => {
      const id = $('view-details').dataset.itemId;
      if (id) confirmDeleteItem(id);
    });

    // Delete confirmation
    $('delete-confirm-btn').addEventListener('click', async () => {
      const id = $('delete-modal').dataset.itemId;
      if (id) await deleteItem(id);
    });

    // Password strength in item form
    $('item-password').addEventListener('input', (e) => {
      const pwd = e.target.value;
      const meter = $('item-strength-meter');
      const segments = meter ? meter.querySelectorAll('.strength-segment') : [];
      const labelEl = $('item-strength-label');
      
      if (!pwd) {
         segments.forEach(s => s.className = 'strength-segment');
         labelEl.textContent = '';
         return;
      }
      
      const { score, label } = Crypto.checkPasswordStrength(pwd);
      
      // Mapping out of 9 to 4 segments
      // score <= 2 -> 1 segment (weak)
      // score <= 4 -> 2 segments (weak/medium)
      // score <= 6 -> 3 segments (medium)
      // score >= 7 -> 4 segments (strong)
      let activeCount = 0;
      let strengthClass = '';
      
      if (score <= 2) { activeCount = 1; strengthClass = 'weak'; }
      else if (score <= 4) { activeCount = 2; strengthClass = 'weak'; }
      else if (score <= 6) { activeCount = 3; strengthClass = 'medium'; }
      else { activeCount = 4; strengthClass = 'strong'; }

      segments.forEach((s, idx) => {
        s.className = 'strength-segment';
        if (idx < activeCount) {
          s.classList.add('active', strengthClass);
        }
      });
      
      labelEl.textContent = label;
      
      // Set label text color matching the active segments
      if (strengthClass === 'weak') labelEl.style.color = '#EF4444';
      else if (strengthClass === 'medium') labelEl.style.color = '#FBBF24';
      else if (strengthClass === 'strong') labelEl.style.color = '#10B981';
      else labelEl.style.color = 'inherit';
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

    // Menu logic (PC & Mobile)
    const menuBtn = $('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = $('sidebar-overlay');
    const shell = $('app-shell');

    const toggleMenu = () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('show');
      } else {
        shell.classList.toggle('sidebar-collapsed');
      }
    };

    if (menuBtn) menuBtn.onclick = toggleMenu;
    if (overlay) overlay.onclick = toggleMenu;
    if ($('mobile-close-sidebar')) $('mobile-close-sidebar').onclick = toggleMenu;

    // Close menu when navigating on mobile
    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (sidebar.classList.contains('mobile-open')) toggleMenu();
      });
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
    const list = $('vault-list');
    const tableContainer = $('vault-table-container');
    const emptyContainer = $('vault-empty-container');
    
    list.innerHTML = '';
    
    const wrapper = $('vault-dashboard-wrapper');
    if (wrapper) {
      if (currentFilter === 'all' && !currentSearch) {
        showEl(wrapper, 'block');
      } else {
        hideEl(wrapper);
      }
    }

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
      hideEl(tableContainer);
      const safeSearch = escapeHTML(currentSearch);
      emptyContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="shield-off" style="width:64px;height:64px"></i></div>
          <h3>${currentSearch ? 'Aucun résultat' : 'Coffre vide'}</h3>
          <p>${currentSearch ? `Aucun élément ne correspond à "${safeSearch}"` : 'Ajoutez votre premier élément sécurisé.'}</p>
          ${!currentSearch ? `<button class="btn btn-primary" id="empty-add-btn" style="margin-top:1.5rem"><i data-lucide="plus" style="width:18px;margin-right:8px"></i> Ajouter un élément</button>` : ''}
        </div>
      `;
      lucide.createIcons();
      const emptyAddBtn = document.getElementById('empty-add-btn');
      if (emptyAddBtn) {
        // Map current filter to a valid creation type
        let defaultType = 'login';
        if (currentFilter === 'note') defaultType = 'note';
        
        emptyAddBtn.addEventListener('click', () => openEditPane(null, defaultType));
      }
      return;
    }

    showEl(tableContainer, 'block');
    emptyContainer.innerHTML = '';

    // Update table header based on filter
    const thead = tableContainer.querySelector('thead');
    if (thead) {
      if (currentFilter === 'note') {
        thead.innerHTML = `
          <tr>
            <th class="col-fav"></th>
            <th class="col-icon"></th>
            <th class="col-name">Nom</th>
            <th class="col-notes">Notes</th>
            <th class="col-updated">Modifié</th>
            <th class="col-actions">Actions</th>
          </tr>
        `;
      } else if (currentFilter === 'login') {
        thead.innerHTML = `
          <tr>
            <th class="col-fav"></th>
            <th class="col-icon"></th>
            <th class="col-name">Nom</th>
            <th class="col-user">Identifiant</th>
            <th class="col-pass">Mot de passe</th>
            <th class="col-updated">Modifié</th>
            <th class="col-actions">Actions</th>
          </tr>
        `;
      } else {
        // Mon Coffre / Favoris
        thead.innerHTML = `
          <tr>
            <th class="col-fav"></th>
            <th class="col-icon"></th>
            <th class="col-name">Nom</th>
            <th class="col-user">Identifiant</th>
            <th class="col-pass">Mot de passe</th>
            <th class="col-notes">Notes</th>
            <th class="col-updated">Modifié</th>
            <th class="col-actions">Actions</th>
          </tr>
        `;
      }
    }

    filtered.forEach(item => {
      const row = createVaultRow(item);
      list.appendChild(row);
    });

    // CRITICAL: Draw icons for dynamically created cards
    lucide.createIcons();
    updateStats();
    updateNavBadges();
  }

  function createVaultRow(item) {
    const tr = document.createElement('tr');
    tr.className = 'fade-in';
    tr.setAttribute('role', 'button');
    tr.onclick = () => openViewPane(item);

    // Column: Favorite
    const tdFav = document.createElement('td');
    tdFav.className = 'col-fav';
    tdFav.setAttribute('data-label', 'Favori');
    const favBtn = document.createElement('button');
    favBtn.className = 'btn btn-icon btn-ghost fav-btn' + (item.favorite ? ' active' : '');
    favBtn.innerHTML = `<i data-lucide="star" style="width:18px; height:18px; ${item.favorite ? 'fill: var(--bw-primary);' : ''}"></i>`;
    favBtn.title = item.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
    favBtn.onclick = async (e) => {
      e.stopPropagation();
      await toggleFavorite(item);
    };
    tdFav.appendChild(favBtn);
    tr.appendChild(tdFav);

    // Column: Icon
    const tdIcon = document.createElement('td');
    tdIcon.className = 'col-icon';
    let iconName = 'key';
    if (item.type === 'login') iconName = 'globe';
    if (item.type === 'note') iconName = 'sticky-note';
    tdIcon.innerHTML = `<div class="table-icon-wrapper"><i data-lucide="${iconName}" style="width:16px; height:16px"></i></div>`;
    tr.appendChild(tdIcon);

    // Column: Name
    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    tdName.setAttribute('data-label', 'Nom');
    tdName.textContent = item.name || 'Sans titre';
    tr.appendChild(tdName);

    const showLoginCols = currentFilter !== 'note';
    const showNoteCol  = currentFilter !== 'login';

    if (showLoginCols) {
      // Column: User/Identifier
      const tdUser = document.createElement('td');
      tdUser.className = 'col-user';
      tdUser.setAttribute('data-label', 'Identifiant');
      tdUser.textContent = item.username || '—';
      tr.appendChild(tdUser);

      // Column: Password
      const tdPass = document.createElement('td');
      tdPass.className = 'col-pass';
      tdPass.setAttribute('data-label', 'Mot de passe');
      if (item.password && item.type === 'login') {
        const passGroup = document.createElement('div');
        passGroup.className = 'table-pass-group';
        
        const passVal = document.createElement('span');
        passVal.className = 'table-pass-val';
        passVal.textContent = '••••••••';
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-icon btn-ghost btn-sm';
        toggleBtn.innerHTML = '<i data-lucide="eye" style="width:14px"></i>';
        toggleBtn.onclick = (e) => {
          e.stopPropagation();
          const isHidden = passVal.textContent === '••••••••';
          passVal.textContent = isHidden ? item.password : '••••••••';
          toggleBtn.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}" style="width:14px"></i>`;
          lucide.createIcons();
        };

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-icon btn-ghost btn-sm';
        copyBtn.innerHTML = '<i data-lucide="copy" style="width:14px"></i>';
        copyBtn.onclick = (e) => {
          e.stopPropagation();
          copyToClipboard(item.password, 'Mot de passe copié');
        };

        passGroup.appendChild(passVal);
        passGroup.appendChild(toggleBtn);
        passGroup.appendChild(copyBtn);
        tdPass.appendChild(passGroup);
      } else {
        tdPass.textContent = '—';
      }
      tr.appendChild(tdPass);
    }

    if (showNoteCol) {
      // Column: Masked Notes
      const tdNotes = document.createElement('td');
      tdNotes.className = 'col-notes';
      tdNotes.setAttribute('data-label', 'Notes');
      if (item.notes) {
        const noteGroup = document.createElement('div');
        noteGroup.className = 'table-pass-group';
        
        const noteVal = document.createElement('span');
        noteVal.className = 'table-pass-val';
        noteVal.textContent = '••••••••';
        noteVal.style.fontSize = '0.8125rem';
        noteVal.style.color = 'var(--bw-text-muted)';
        
        const previewText = item.notes.replace(/\n/g, ' ');
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-icon btn-ghost btn-sm';
        toggleBtn.innerHTML = '<i data-lucide="eye" style="width:14px"></i>';
        toggleBtn.onclick = (e) => {
          e.stopPropagation();
          const isHidden = noteVal.textContent === '••••••••';
          noteVal.textContent = isHidden ? (previewText.length > 50 ? previewText.substring(0, 50) + '...' : previewText) : '••••••••';
          toggleBtn.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}" style="width:14px"></i>`;
          lucide.createIcons();
        };

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-icon btn-ghost btn-sm';
        copyBtn.innerHTML = '<i data-lucide="copy" style="width:14px"></i>';
        copyBtn.onclick = (e) => {
          e.stopPropagation();
          copyToClipboard(item.notes, 'Note copiée');
        };

        noteGroup.appendChild(noteVal);
        noteGroup.appendChild(toggleBtn);
        noteGroup.appendChild(copyBtn);
        tdNotes.appendChild(noteGroup);
      } else {
        tdNotes.textContent = '—';
      }
      tr.appendChild(tdNotes);
    }

    // Column: Date
    const tdDate = document.createElement('td');
    tdDate.className = 'col-updated';
    tdDate.setAttribute('data-label', 'Modifié');
    tdDate.textContent = formatDate(item.updated_at);
    tr.appendChild(tdDate);

    // Column: Actions
    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-icon btn-ghost';
    editBtn.style.color = 'var(--bw-primary)';
    editBtn.title = 'Modifier';
    editBtn.innerHTML = '<i data-lucide="edit-3" style="width:16px"></i>';
    editBtn.onclick = (e) => { e.stopPropagation(); openEditPane(item.id); };
    
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-icon btn-ghost';
    delBtn.style.color = '#EF4444';
    delBtn.title = 'Supprimer';
    delBtn.innerHTML = '<i data-lucide="trash-2" style="width:16px"></i>';
    delBtn.onclick = (e) => { e.stopPropagation(); confirmDeleteItem(item.id); };
    
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    tdActions.appendChild(actions);
    tr.appendChild(tdActions);

    return tr;
  }

  async function toggleFavorite(item) {
    const originalStatus = item.favorite;
    const newStatus = !originalStatus;

    try {
      // Direct local update for immediate UI feedback
      item.favorite = newStatus;
      const vaultItem = vaultItems.find(v => v.id === item.id);
      if (vaultItem) {
        vaultItem.favorite = newStatus;
      }
      
      renderVault();

      // We need to send ALL encrypted fields because the backend PUT /api/vault/:id 
      // requires them (validation). Our crypto.js now ensures these are in the object.
      await API.updateItem(item.id, {
        type: item.type,
        name_enc: item.name_enc,
        data_enc: item.data_enc,
        iv: item.iv,
        auth_tag: item.auth_tag,
        favorite: newStatus,
        folder_id: item.folder_id
      });
      
      showToast(newStatus ? 'Ajouté aux favoris' : 'Retiré des favoris', 'info');
    } catch (err) {
      // Revert on failure
      item.favorite = originalStatus;
      const vaultItem = vaultItems.find(v => v.id === item.id);
      if (vaultItem) {
        vaultItem.favorite = originalStatus;
      }
      renderVault();
      
      console.error('Error toggling favorite:', err);
      showToast('Erreur lors de la mise à jour du favori', 'error');
    }
  }

  // ─── Details Pane: View Element ─────────────────────────────────────────────
  function openViewPane(item) {
    hideEl($('view-vault'));
    hideEl($('view-editor'));
    showEl($('top-bar-back'), 'flex');
    
    $('view-details').dataset.itemId = item.id;
    $('view-item-name').textContent = item.name || 'Sans titre';
    
    // Default labels
    const userLabel = $('view-username-val').previousElementSibling;
    const passField = $('view-password-val').parentElement;
    const urlField  = $('view-url-val').parentElement;
    
    if (userLabel) userLabel.textContent = 'Identifiant';
    showEl(passField, 'flex');
    showEl(urlField, 'flex');

    if (item.type === 'note') {
      hideEl($('view-username-val').parentElement);
      hideEl(passField);
      hideEl(urlField);
    } else {
      showEl($('view-username-val').parentElement, 'flex');
      $('view-username-val').textContent = item.username || '—';
      $('view-password-val').textContent = item.password ? '••••••••' : '—';
      $('view-password-val').dataset.raw = item.password || '';
      $('view-toggle-pass').style.display = item.password ? '' : 'none';
      $('view-copy-pass').style.display = item.password ? '' : 'none';
    }

    $('view-notes-val').textContent = item.notes || '—';

    // Show/hide URL as link logic
    const urlEl = $('view-url-val');
    if (item.url && item.type === 'login') {
      const a = document.createElement('a');
      a.href = item.url.startsWith('http') ? item.url : `https://${item.url}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.url;
      urlEl.textContent = '';
      urlEl.appendChild(a);
      showEl(urlField, 'flex');
    } else if (item.type !== 'login') {
      hideEl(urlField);
    } else {
      urlEl.textContent = '—';
    }

    $('top-bar-title').textContent = 'Détails de l\'élément';
    showEl($('view-details'), 'block');
  }

  // ─── Details Pane: Create / Edit Element ──────────────────────────────────────
  function openEditPane(itemId, forcedType = null) {
    editingItemId = itemId;
    const item = itemId ? vaultItems.find(v => v.id === itemId) : null;
    
    hideEl($('view-vault'));
    hideEl($('view-details'));
    hideEl($('view-admin'));
    if (itemId) {
      showEl($('top-bar-back'), 'flex');
    } else {
      hideEl($('top-bar-back'));
    }

    const isMobile = window.innerWidth <= 768;
    const titleText = item ? 'Modifier' : 'Nouveau';
    $('top-bar-title').textContent = isMobile ? titleText : (item ? 'Modifier l\'élément' : 'Nouvel élément');
    $('item-form').reset();
    
    // Reset strength meter
    const meter = $('item-strength-meter');
    if (meter) meter.querySelectorAll('.strength-segment').forEach(s => s.className = 'strength-segment');
    $('item-strength-label').textContent = '';

    // Reset tabs
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    const defaultType = item ? item.type : (forcedType || 'login');
    document.querySelector(`.type-tab[data-type="${defaultType}"]`)?.classList.add('active');
    updateFormForType(defaultType);

    if (item) {
      $('item-name').value = item.name || '';
      $('item-username').value = item.username || '';
      $('item-password').value = item.password || '';
      $('item-url').value = item.url || '';
      $('item-notes').value = item.notes || '';
      $('item-favorite').checked = item.favorite || false;
      
      // Trigger password strength logic if password exists
      if (item.password) {
        $('item-password').dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Generate a password suggestion for new items
    if (!item) {
      try {
        generateAndFill();
      } catch (e) {
        console.warn("Pré-génération échouée", e);
      }
    }

    try { lucide.createIcons(); } catch(e) {}
    showEl($('view-editor'), 'block');
    // Scroll au sommet pour être sûr de voir le formulaire
    $('view-editor').scrollTop = 0;
  }

  function updateFormForType(type) {
    const loginFields    = document.querySelectorAll('.login-only-fields');
    const identityFields = document.querySelectorAll('.identity-only-fields');
    const grid = $('item-form-grid');
    
    // Default: hide everything
    loginFields.forEach(el => hideEl(el));
    identityFields.forEach(el => hideEl(el));

    if (type === 'login') {
      loginFields.forEach(el => { showEl(el, 'flex'); el.style.flexDirection = 'column'; });
      if (grid) {
        grid.style.gridTemplateColumns = '1fr 1fr';
        grid.style.gap = '4rem';
        grid.style.maxWidth = 'none';
        grid.style.margin = '0';
        $('item-notes').rows = 2;
      }
    } else if (type === 'note') {
      if (grid) {
        grid.style.gridTemplateColumns = '1fr';
        grid.style.gap = '0.25rem';
        grid.style.maxWidth = '800px';
        grid.style.margin = '0 auto';
        $('item-notes').rows = 8;
      }
    }
  }

  function closeAllModals() {
    ['delete-modal-overlay'].forEach(id => {
      const el = $(id);
      if (el) hideEl(el);
    });
    
    switchView('view-vault');

    // Remettre le badge actif sur "Tous les éléments" si on sort d'un ajout
    const allTab = document.querySelector('.nav-item[data-filter="all"]');
    if (allTab && !document.querySelector('.nav-item.active')) {
      allTab.classList.add('active');
    }

    editingItemId = null;
  }

  async function openAdminView() {
    switchView('view-admin');
    
    $('top-bar-title').textContent = 'Supervision';
    showEl($('top-bar-back'), 'flex');

    await Promise.all([
      loadAdminStats(),
      loadAdminLogs('combined', 'admin-logs-viewer'),
      loadAdminLogs('error', 'admin-error-logs-viewer')
    ]);
  }

  async function loadAdminStats() {
    try {
      const stats = await API.getAdminStats();
      $('admin-stat-users').textContent = stats.users;
      $('admin-stat-items').textContent = stats.items;
      $('admin-stat-sessions').textContent = stats.sessions;
    } catch (err) {
      showToast('Erreur stats admin.', 'error');
    }
  }

  async function loadAdminLogs(type, viewerId) {
    const viewer = $(viewerId);
    viewer.innerHTML = '<div style="opacity: 0.5">Chargement...</div>';
    
    try {
      const { logs } = await API.getAdminLogs(type);
      if (!logs || logs.length === 0) {
        viewer.innerHTML = '<div style="opacity:0.5; font-style:italic">Aucun log disponible.</div>';
        return;
      }

      viewer.innerHTML = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const meta = log.userId ? ` <span style="color:#569cd6">[U:${log.userId.substring(0,6)}]</span>` : '';
        const safeMsg = escapeHTML(log.message);
        
        return `<div class="log-line" style="margin-bottom: 2px; line-height: 1.2;">
          <span style="color: #858585;">[${time}]</span> 
          <span style="font-weight:700; color:${log.level === 'error' ? '#f44747' : (log.level === 'warn' ? '#dcdcaa' : '#4ec9b0')}">${(log.level || 'INFO').toUpperCase()}</span>: 
          <span>${safeMsg}</span>${meta}
        </div>`;
      }).join('');
      
    } catch (err) {
      viewer.innerHTML = `<div style="color:#f44747">Erreur: ${err.message}</div>`;
    }
  }

  function switchView(viewId) {
    const views = ['view-vault', 'view-details', 'view-editor', 'view-generator', 'view-admin', 'view-settings'];
    views.forEach(v => hideEl($(v)));
    showEl($(viewId), 'block');
  }

  async function openSettingsView() {
    switchView('view-settings');
    $('top-bar-title').textContent = 'Mon Compte';
    hideEl($('top-bar-actions'));
    
    // Refresh 2FA status
    try {
      const res = await API.getMe();
      const isEnabled = !!res.user.is_totp_enabled;
      showEl($(isEnabled ? '2fa-status-on' : '2fa-status-off'));
      hideEl($(isEnabled ? '2fa-status-off' : '2fa-status-on'));
      hideEl($('2fa-setup-panel'));
    } catch (err) {
      showToast('Erreur lors de la récupération des infos compte.', 'error');
    }
  }

  async function handle2FASetup() {
    try {
      const res = await API.setup2FA();
      $('2fa-qr-code').src = res.qrCodeDataUrl;
      showEl($('2fa-setup-panel'));
      $('setup-2fa-btn').disabled = true;
    } catch (err) {
      showToast('Impossible de générer le QR code.', 'error');
    }
  }

  async function handle2FAEnable() {
    const code = $('2fa-verify-code').value;
    if (!code || code.length !== 6) return showToast('Entrez un code valide à 6 chiffres.');

    try {
      const res = await API.enable2FA(code);
      showToast(res.message, 'success');
      openSettingsView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handle2FADisable() {
    const code = prompt('Entrez votre code 2FA pour confirmer la désactivation :');
    if (!code) return;

    try {
      const res = await API.disable2FA(code);
      showToast(res.message, 'success');
      openSettingsView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleChangeMasterPassword(e) {
    e.preventDefault();
    const currentPass = $('current-master-password').value;
    const newPass = $('new-master-password').value;

    if (!confirm('Êtes-vous sûr de vouloir changer votre mot de passe maître ? Toutes vos données seront ré-encodées localement puis synchronisées. Cette opération peut prendre un moment.')) return;

    const btn = e.target.querySelector('button');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Calculs en cours...';

    try {
      // 1. Verify current password hash (Zero-Knowledge)
      const currentSalt = sessionStorage.getItem('sv_salt');
      const currentAuthHash = await Crypto.deriveAuthHash(currentPass, currentSalt);
      
      // 2. Derive new crypto requirements
      const newSalt = Crypto.generateSalt();
      const newEncryptionKey = await Crypto.deriveEncryptionKey(newPass, newSalt);
      const newAuthHash = await Crypto.deriveAuthHash(newPass, newSalt);

      // 3. Re-encrypt all items currently in memory
      showToast('Ré-encodage des données locales...', 'info');
      const reEncryptedItems = [];
      for (const item of vaultItems) {
        const enc = await Crypto.encryptVaultItem(item, newEncryptionKey);
        reEncryptedItems.push({ id: item.id, ...enc });
      }

      // 4. Submit auth change to server
      showToast('Mise à jour du compte sur le serveur...', 'info');
      await API.changePassword(currentAuthHash, newAuthHash, newSalt);
      
      // 5. Bulk update vault items with new encryption
      showToast('Synchronisation du coffre-fort...', 'info');
      await API.bulkUpdateVault(reEncryptedItems);

      showToast('Mot de passe maître changé avec succès ! Vous allez être déconnecté.', 'success');
      
      // Success! Need to re-login with new password to ensure everything is correct
      setTimeout(() => {
        window.handleLogout();
      }, 3000);

    } catch (err) {
      console.error('Password change failed', err);
      showToast(`Erreur: ${err.message || 'Impossible de changer le mot de passe'}`, 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function openGeneratorView() {
    switchView('view-generator');
    const isMobile = window.innerWidth <= 768;
    $('top-bar-title').textContent = isMobile ? 'Générateur' : 'Générateur de mot de passe';
    generateForTool();
  }

  function generateForTool() {
    const opts = {
      length: parseInt($('tool-gen-length').value, 10),
      uppercase: $('tool-gen-upper').checked,
      lowercase: $('tool-gen-lower').checked,
      numbers: $('tool-gen-nums').checked,
      symbols: $('tool-gen-syms').checked,
      excludeAmbiguous: $('tool-gen-no-ambig').checked,
    };
    try {
      const pwd = Crypto.generatePassword(opts);
      $('tool-gen-password-preview').textContent = pwd;
    } catch (err) {
      showToast(err.message, 'warning');
    }
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
      // Identity fields
      firstName: $('item-first-name')?.value.trim() || '',
      lastName: $('item-last-name')?.value.trim() || '',
      email: $('item-identity-email')?.value.trim() || '',
      phone: $('item-phone')?.value.trim() || '',
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
        if (idx !== -1) vaultItems[idx] = { id: editingItemId, ...plainItem, ...encrypted };
        showToast('Élément mis à jour.', 'success');
      } else {
        const result = await API.createItem(encrypted);
        vaultItems.unshift({ id: result.id, ...plainItem, ...encrypted, created_at: Date.now(), updated_at: Date.now() });
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
    $('stat-notes').textContent   = vaultItems.filter(v => v.type === 'note').length;
    $('stat-weak').textContent    = vaultItems.filter(v => v.password && Crypto.checkPasswordStrength(v.password).score <= 4).length;
    $('stat-favs').textContent    = vaultItems.filter(v => v.favorite).length;
  }

  function updateNavBadges() {
    if ($('badge-all')) $('badge-all').textContent = vaultItems.length;
    if ($('badge-favorites')) $('badge-favorites').textContent = vaultItems.filter(i => i.favorite).length;
    if ($('badge-login')) $('badge-login').textContent = vaultItems.filter(i => i.type === 'login').length;
    if ($('badge-note')) $('badge-note').textContent = vaultItems.filter(i => i.type === 'note').length;
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

  // ─── Export Functions ──────────────────────────────────────────────────────
  function downloadFile(content, fileName, contentType) {
    const a = document.createElement('a');
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportAsJSON() {
    if (vaultItems.length === 0) return showToast('Le coffre est vide.', 'warning');
    const data = JSON.stringify(vaultItems, null, 2);
    downloadFile(data, 'securevault_export.json', 'application/json');
    showToast('Export JSON terminé.');
  }

  function exportAsCSV() {
    if (vaultItems.length === 0) return showToast('Le coffre est vide.', 'warning');
    const headers = ['Type', 'Nom', 'Identifiant', 'Mot de passe', 'URL', 'Favori', 'Notes', 'Modifié'];
    const rows = vaultItems.map(item => [
      item.type,
      item.name || '',
      item.username || '',
      item.password || '',
      item.url || '',
      item.favorite ? 'Oui' : 'Non',
      (item.notes || '').replace(/\r?\n/g, ' '),
      formatDate(item.updated_at)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    downloadFile(csvContent, 'securevault_export.csv', 'text/csv;charset=utf-8;');
    showToast('Export CSV terminé.');
  }

  function exportAsPDF() {
    if (vaultItems.length === 0) return showToast('Le coffre est vide.', 'warning');
    
    showToast('Génération du PDF...');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return showToast('Veuillez autoriser les popups pour l\'export PDF.', 'warning');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Export SecureVault - ${currentUser.email}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=JetBrains+Mono&display=swap');
          body { font-family: 'Inter', sans-serif; padding: 50px; color: #1a1a1a; line-height: 1.5; }
          .header { border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
          h1 { margin: 0; font-size: 24pt; letter-spacing: -0.02em; }
          .meta { font-size: 10pt; color: #666; text-align: right; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid #e5e5e5; padding: 12px 10px; text-align: left; vertical-align: top; word-break: break-all; }
          th { background-color: #f9f9f9; font-weight: 700; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; }
          td { font-size: 10pt; }
          .mono { font-family: 'JetBrains Mono', monospace; font-size: 9pt; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
          .footer { margin-top: 50px; font-size: 8pt; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
          @media print {
            body { padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div><h1>SecureVault</h1><p>Export de coffre-fort hautement sécurisé</p></div>
          <div class="meta">
            <strong>Utilisateur :</strong> ${currentUser.email}<br>
            <strong>Date :</strong> ${new Date().toLocaleString('fr-FR')}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 15%">Type</th>
              <th style="width: 25%">Nom / Site</th>
              <th style="width: 20%">Identifiant</th>
              <th style="width: 20%">Mot de passe</th>
              <th style="width: 20%">Notes</th>
            </tr>
          </thead>
          <tbody>
            ${vaultItems.map(item => `
              <tr>
                <td>${item.type === 'login' ? 'Identifiant' : 'Note'}</td>
                <td><strong>${escapeHTML(item.name)}</strong><br><small>${escapeHTML(item.url) || ''}</small></td>
                <td>${escapeHTML(item.username) || '—'}</td>
                <td><span class="mono">${escapeHTML(item.password) || '—'}</span></td>
                <td style="font-size: 9pt">${escapeHTML(item.notes) || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="footer">
          Ce document contient des informations confidentielles. Conservez-le dans un endroit sûr.<br>
          Généré par SecureVault — Zero-Knowledge Architecture.
        </div>
        <script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); }</script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  }
  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target.result;
      let itemsToImport = [];

      try {
        if (file.name.endsWith('.json')) {
          itemsToImport = JSON.parse(content);
        } else if (file.name.endsWith('.csv')) {
          itemsToImport = parseCSVImport(content);
        } else {
          throw new Error('Format de fichier non supporté. Utilisez JSON ou CSV.');
        }

        if (!Array.isArray(itemsToImport)) {
          itemsToImport = [itemsToImport];
        }

        if (itemsToImport.length === 0) {
          showToast('Aucun élément trouvé dans le fichier.', 'warning');
          return;
        }

        const confirmImport = confirm(`Importer ${itemsToImport.length} éléments dans votre coffre ?`);
        if (!confirmImport) return;

        // Normaliser TOUTES les clés en minuscules et SANS ESPACES pour l'import JSON/CSV
        itemsToImport = itemsToImport.map(item => {
          const normalized = {};
          for (const key in item) {
            // "Mot de Passe" -> "motdepasse"
            const cleanKey = key.toLowerCase().trim().replace(/\s+/g, '');
            normalized[cleanKey] = item[key];
          }
          return normalized;
        });

        showToast(`Importation de ${itemsToImport.length} éléments...`, 'info');
        
        let successCount = 0;
        for (const rawItem of itemsToImport) {
          try {
            // Map common field names
            const plainItem = {
              type: rawItem.type || (rawItem.password ? 'login' : (rawItem.notes || rawItem.note ? 'note' : 'login')),
              name: rawItem.name || rawItem.nom || rawItem.title || 'Élément importé',
              username: rawItem.username || rawItem.identifiant || rawItem.login || rawItem.user || '',
              password: rawItem.password || rawItem.motdepasse || rawItem.pass || '',
              url: rawItem.url || rawItem.website || rawItem.site || '',
              notes: rawItem.notes || rawItem.note || '',
              favorite: !!(rawItem.favorite || rawItem.favori)
            };

            if (!rawItem.name && !rawItem.nom && (rawItem.password || rawItem.notes)) {
              plainItem.name = rawItem.url || rawItem.username || 'Import sans nom';
            }

            const encrypted = await Crypto.encryptVaultItem(plainItem, encryptionKey);
            const result = await API.createItem(encrypted);
            
            vaultItems.unshift({ 
              id: result.id, 
              ...plainItem, 
              ...encrypted, 
              created_at: Date.now(), 
              updated_at: Date.now() 
            });
            successCount++;
          } catch (itemErr) {
            console.error('Failed to import item:', itemErr);
          }
        }

        showToast(`${successCount} éléments importés avec succès !`, 'success');
        renderVault();
        updateStats();

      } catch (err) {
        showToast(`Erreur d'importation: ${err.message}`, 'error');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  function parseCSVImport(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];

    // Détection auto du séparateur (, ou ;) car Excel FR utilise souvent ;
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const sep = semiCount > commaCount ? ';' : ',';

    const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    
    return lines.slice(1).map(line => {
      // Regex adaptée au séparateur détecté
      const regex = new RegExp(`${sep}(?=(?:(?:[^"]*"){2})*[^"]*$)`);
      const parts = line.split(regex);
      const item = {};
      headers.forEach((header, index) => {
        let val = parts[index] ? parts[index].trim().replace(/^"|"$/g, '').replace(/""/g, '"') : '';
        item[header] = val;
      });
      return item;
    });
  }

  // ─── Public Interface ────────────────────────────────────────────────────────
  return {
    init,
    openEditPane,
    openViewPane,
    copyToClipboard,
    generateAndFill,
    closeAllModals,
    init
  };
})();

// Global handleLogout accessible from app.html inline onclick
window.handleLogout = async (e) => {
  if (e) e.preventDefault();
  console.log('--- GLOBAL LOGOUT START ---');
  
  try {
    // We use direct fetch to be safe from any object naming issues
    const res = await fetch('/api/auth/logout', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Server response status:', res.status);
  } catch (err) {
    console.error('Network error during logout:', err);
  }
  
  // Always clear local state even if server fetch failed
  sessionStorage.clear();
  console.log('SessionStorage cleared');
  
  // Use replace to ensure index.html doesn't find old session in cache
  window.location.replace('/index.html?t=' + Date.now());
};

// Start app
document.addEventListener('DOMContentLoaded', () => {
    App.init();
    lucide.createIcons();
    
    // Also attach to the button if it exists (backup)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', window.handleLogout);
});
