// Content script for SecureVault - Advanced Autofill & Generation
console.log("SecureVault Content Script actif.");

const STATE = {
  activeInput: null,
  popup: null
};

// --- Detection & Injection ---

function injectSecureIcon(field) {
  if (field.dataset.svInjected) return;
  field.dataset.svInjected = "true";

  // Container styling
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';
  wrapper.style.width = '100%';
  
  field.parentNode.insertBefore(wrapper, field);
  wrapper.appendChild(field);

  const icon = document.createElement('div');
  icon.innerHTML = 'S';
  icon.style = `
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    background: #F97316;
    color: white;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 14px;
    cursor: pointer;
    z-index: 10;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    transition: transform 0.2s;
  `;
  icon.title = "Générer un mot de passe sécurisé (SecureVault)";
  
  icon.onmouseover = () => icon.style.transform = 'translateY(-50%) scale(1.1)';
  icon.onmouseout = () => icon.style.transform = 'translateY(-50%) scale(1.0)';
  
  icon.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Vérifier si l'utilisateur est connecté
    chrome.runtime.sendMessage({ action: "GET_VAULT" }, (response) => {
      if (response && response.isAuthenticated) {
        showGeneratorPopup(field, icon);
      } else {
        showLoginPrompt(field, icon);
      }
    });
  };

  wrapper.appendChild(icon);
}

function showLoginPrompt(input, anchor) {
  if (STATE.popup) STATE.popup.remove();
  const popup = document.createElement('div');
  popup.style = `
    position: absolute;
    top: 30px;
    right: 0;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    padding: 1.25rem;
    z-index: 10001;
    width: 240px;
    border: 1px solid #E2E8F0;
    font-family: 'Inter', system-ui, sans-serif;
    color: #1e293b;
    text-align: center;
  `;

  popup.innerHTML = `
    <div style="font-weight: 700; font-size: 14px; margin-bottom: 0.75rem; color: #0f172a">Session expirée</div>
    <p style="font-size: 12px; color: #64748b; margin-bottom: 1rem">Veuillez vous connecter pour utiliser SecureVault.</p>
    <button id="sv-open-login" style="background: #0f172a; color: white; border: none; padding: 0.6rem; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; width: 100%">Se connecter</button>
  `;

  anchor.parentNode.appendChild(popup);
  STATE.popup = popup;

  popup.querySelector('#sv-open-login').onclick = () => {
    chrome.runtime.sendMessage({ action: "OPEN_APP_WITH_SESSION" });
    popup.remove();
    STATE.popup = null;
  };

  const closer = (e) => {
    if (!popup.contains(e.target) && e.target !== anchor) {
      popup.remove();
      STATE.popup = null;
      document.removeEventListener('mousedown', closer);
    }
  };
  document.addEventListener('mousedown', closer);
}

function showGeneratorPopup(input, anchor) {
  if (STATE.popup) STATE.popup.remove();

  const popup = document.createElement('div');
  popup.style = `
    position: absolute;
    top: 30px;
    right: 0;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    padding: 1.25rem;
    z-index: 10001;
    width: 240px;
    border: 1px solid #E2E8F0;
    font-family: 'Inter', system-ui, sans-serif;
    color: #1e293b;
    text-align: left;
  `;

  const pass = CryptoUtils.generatePassword(20);
  
  popup.innerHTML = `
    <div style="font-weight: 700; font-size: 14px; margin-bottom: 0.75rem; color: #0f172a">Nouveau mot de passe</div>
    <div id="sv-generated-pass" style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 13px; margin-bottom: 1rem; word-break: break-all; color: #0f172a">${pass}</div>
    <div style="display: grid; gap: 0.5rem">
      <button id="sv-use-pass" style="background: #F97316; color: white; border: none; padding: 0.6rem; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px">Utiliser & Remplir</button>
      <button id="sv-regen-pass" style="background: white; color: #475569; border: 1px solid #e2e8f0; padding: 0.6rem; border-radius: 6px; font-weight: 500; cursor: pointer; font-size: 13px">Régénérer</button>
    </div>
  `;

  anchor.parentNode.appendChild(popup);
  STATE.popup = popup;

  popup.querySelector('#sv-use-pass').onclick = () => {
    const finalPass = popup.querySelector('#sv-generated-pass').textContent;
    input.value = finalPass;
    input.dataset.svGenerated = "true"; // Marquer que ce MDP a été généré
    input.dispatchEvent(new Event('input', { bubbles: true }));
    popup.remove();
    STATE.popup = null;
  };

  popup.querySelector('#sv-regen-pass').onclick = () => {
    popup.querySelector('#sv-generated-pass').textContent = CryptoUtils.generatePassword(20);
  };

  // Fermer si clic ailleurs
  const closer = (e) => {
    if (!popup.contains(e.target) && e.target !== anchor) {
      popup.remove();
      STATE.popup = null;
      document.removeEventListener('mousedown', closer);
    }
  };
  document.addEventListener('mousedown', closer);
}

function detectLoginFields() {
  const passwordFields = document.querySelectorAll('input[type="password"]');
  passwordFields.forEach(field => {
    // Éviter d'injecter sur les champs de notre propre app (localhost:3001)
    if (window.location.origin.includes('localhost:3001')) return;
    injectSecureIcon(field);
  });
}

// --- Capture & Save ---

document.addEventListener('submit', (e) => {
  const form = e.target;
  const passwordInput = form.querySelector('input[type="password"]');
  if (!passwordInput || !passwordInput.value) return;

  const usernameInput = form.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"]');
  
  const credentials = {
    username: usernameInput ? usernameInput.value : '',
    password: passwordInput.value,
    url: window.location.href,
    domain: window.location.hostname
  };

  // Si le mot de passe a été généré par nous, on le sauvegarde prioritairement
  if (passwordInput.dataset.svGenerated === "true") {
    console.log("[SecureVault] Mot de passe généré détecté. Sauvegarde en cours...");
    chrome.runtime.sendMessage({ 
      action: "SAVE_GENERATED_PASSWORD", 
      credentials 
    }, (response) => {
      if (response && response.success) {
        showSaveNotification();
      }
    });
  } else {
    // Optionnel: On pourrait aussi proposer de sauvegarder les MDP non-générés
    console.log("[SecureVault] Formulaire soumis. Capture des identifiants...");
  }
});

function showSaveNotification() {
  const toast = document.createElement('div');
  toast.style = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #0f172a;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    z-index: 1000000;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
    animation: sv-toast-in 0.3s ease-out;
  `;
  toast.innerHTML = `
    <span style="color: #22c55e">✓</span>
    Mot de passe enregistré dans SecureVault
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes sv-toast-in {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialisation
function initObserver() {
  if (document.body) {
    detectLoginFields();
    const observer = new MutationObserver(detectLoginFields);
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    setTimeout(initObserver, 100);
  }
}
initObserver();

// --- Sync from App to Extension ---
if (window.location.host === 'localhost:3001' && window.location.pathname === '/app.html') {
  const syncWithExtension = () => {
    const email = sessionStorage.getItem('sv_email');
    const salt = sessionStorage.getItem('sv_salt');
    const mp = sessionStorage.getItem('sv_tmp_mp');
    
    if (email && salt && mp) {
      chrome.runtime.sendMessage({ 
        action: "SYNC_FROM_PAGE", 
        email, salt, mp 
      });
    }
  };
  
  // Appeler au chargement et surveiller les changements
  syncWithExtension();
  // On peut surveiller le sessionStorage si besoin, mais app.js le remplit au début
}

// Service Autofill
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FILL_CREDENTIALS") {
    const passField = document.querySelector('input[type="password"]');
    const userField = document.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"]');
    
    if (userField) userField.value = request.username;
    if (passField) passField.value = request.password;
    
    if (passField) passField.dispatchEvent(new Event('input', { bubbles: true }));
    if (userField) userField.dispatchEvent(new Event('input', { bubbles: true }));
    
    sendResponse({ success: true });
  }
});
