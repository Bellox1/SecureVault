// Popup logic for SecureVault
document.addEventListener('DOMContentLoaded', async () => {
  const lockScreen = document.getElementById('lock-screen');
  const mainUI = document.getElementById('main-ui');
  const unlockBtn = document.getElementById('unlock-btn');
  const emailInput = document.getElementById('email');
  const masterPassInput = document.getElementById('master-password');
  const itemsList = document.getElementById('items-list');
  const sessionEmail = document.getElementById('session-email');

  // Helper pour ouvrir le site en mode "App" (Fenêtre sans barre d'adresse)
  function openAppWindow(url) {
    chrome.windows.create({
      url: url,
      type: 'popup',
      width: 1240,
      height: 850
    });
  }

  // Nouveaux boutons pour ouvrir le site en mode fenêtré
  const openSiteBtn = document.getElementById('open-site-btn');
  const openRegisterBtn = document.getElementById('open-register-btn');

  if (openSiteBtn) {
    openSiteBtn.addEventListener('click', () => openAppWindow('https://secure-vault.alwaysdata.net/'));
  }
  if (openRegisterBtn) {
    openRegisterBtn.addEventListener('click', () => openAppWindow('https://secure-vault.alwaysdata.net/register.html'));
  }

  // Au chargement, vérifier si une session existe
  chrome.runtime.sendMessage({ action: "GET_VAULT" }, (response) => {
    if (response && response.isAuthenticated) {
      showMainUI(response.data, response.email);
    }
  });

  // Gérer l'œil pour afficher/masquer le mot de passe (avec de vrais SVG)
  const toggleEye = document.getElementById('toggle-eye');
  const eyeOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeClosed = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-10-7-10-7a13.14 13.14 0 0 1 1.66-2.66"/><path d="M15 12a3 3 0 1 1-5.83-1.17"/><path d="M7.53 7.53A10.36 10.36 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;

  toggleEye.addEventListener('click', () => {
    const isPassword = masterPassInput.type === 'password';
    masterPassInput.type = isPassword ? 'text' : 'password';
    toggleEye.innerHTML = isPassword ? eyeClosed : eyeOpen;
  });

  // Gérer la connexion
  unlockBtn.addEventListener('click', () => {
    const email = emailInput.value.trim();
    const password = masterPassInput.value;
    const loginError = document.getElementById('login-error');

    // Cacher l'erreur précédente
    loginError.style.display = 'none';

    if (!email || !password) {
      loginError.textContent = "Veuillez remplir tous les champs.";
      loginError.style.display = 'block';
      return;
    }

    unlockBtn.disabled = true;
    unlockBtn.textContent = "Vérification...";

    // Envoyer les infos au background pour authentification
    chrome.runtime.sendMessage({ 
      action: "LOGIN", 
      email: email, 
      password: password 
    }, (response) => {
      if (response && response.success) {
        showMainUI(response.data, email);
      } else {
        loginError.textContent = response.error || "Identifiants incorrects.";
        loginError.style.display = 'block';
        unlockBtn.disabled = false;
        unlockBtn.textContent = "Se connecter";
      }
    });
  });

  function showMainUI(data, email) {
    // Demander au background d'ouvrir l'app et d'injecter la session Zero-Knowledge
    chrome.runtime.sendMessage({ action: "OPEN_APP_WITH_SESSION" }, () => {
      // Fermer la petite popup
      window.close();
    });
  }

  function renderItems(items) {
    itemsList.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-user">${item.user || item.url}</div>
        </div>
        <button class="copy-btn" title="Copier">🔑</button>
      `;
      itemsList.appendChild(div);
    });
  }
});
