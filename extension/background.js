// Background script for SecureVault
importScripts('crypto_utils.js');

let vaultData = null;
let isAuthenticated = false;
let currentEmail = null;

const API_URL = "http://localhost:3001/api";

// Fonction pour envoyer les logs au serveur
async function logToServer(level, message, data = {}) {
  try {
    await fetch(`${API_URL}/log-extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, data })
    });
  } catch (e) {
    console.error("Impossible d'envoyer le log au serveur", e);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "LOGIN") {
    handleLogin(request.email, request.password).then(sendResponse);
    return true; 
  }
  
  if (request.action === "GET_VAULT") {
    sendResponse({ isAuthenticated, data: vaultData, email: currentEmail });
  }

  if (request.action === "LOGOUT") {
    isAuthenticated = false;
    vaultData = null;
    currentEmail = null;
    sendResponse({ success: true });
  }
});

// Stockage temporaire du mot de passe maître pour injection (effacé après usage)
let tempMasterPassword = null;
let tempSalt = null;

async function handleLogin(email, masterPassword) {
  const normalizedEmail = email.toLowerCase().trim();
  logToServer('info', `Tentative de connexion pour ${normalizedEmail}`);
  
  try {
    // 1. Récupérer le salt
    const saltRes = await fetch(`${API_URL}/auth/salt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail }),
      credentials: 'include'
    });
    
    if (!saltRes.ok) throw new Error("Utilisateur introuvable.");
    const { salt } = await saltRes.json();
    logToServer('info', `Sel récupéré pour ${normalizedEmail}`, { saltLength: salt?.length });

    // 2. Dériver le hash (Zero-Knowledge)
    let passwordHash;
    try {
      passwordHash = await CryptoUtils.deriveAuthHash(masterPassword, salt);
      logToServer('info', `Dérivation réussie pour ${normalizedEmail}`);
    } catch (cryptoErr) {
      logToServer('error', `ÉCHEC DE DÉRIVATION pour ${normalizedEmail}`, { 
        error: cryptoErr.message,
        salt: salt,
        saltType: typeof salt
      });
      throw new Error("Erreur de dérivation cryptographique.");
    }

    // 3. Se connecter
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, passwordHash }),
      credentials: 'include'
    });

    if (!loginRes.ok) {
      const errData = await loginRes.json();
      logToServer('warn', `Connexion refusée par le serveur pour ${normalizedEmail}`, { status: loginRes.status });
      throw new Error(errData.error || "Email ou mot de passe incorrect.");
    }

    // Succès ! On prépare l'injection
    isAuthenticated = true;
    currentEmail = normalizedEmail;
    tempMasterPassword = masterPassword;
    tempSalt = salt;
    
    logToServer('info', `CONNEXION RÉUSSIE pour ${normalizedEmail}. Ouverture de l'app...`);
    return { success: true };
  } catch (error) {
    logToServer('error', `Erreur globale login extension pour ${normalizedEmail}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

// Nouvelle action pour ouvrir l'app et injecter la session
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "OPEN_APP_WITH_SESSION") {
    openAppAndInject();
    sendResponse({ success: true });
  }
});

function openAppAndInject() {
  chrome.windows.create({
    url: 'http://localhost:3001/app.html',
    type: 'popup',
    width: 1240,
    height: 850
  }, (window) => {
    const tabId = window.tabs[0].id;
    
    // Attendre que la page soit prête pour injecter les clés de déchiffrement
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        
        const code = `
          sessionStorage.setItem('sv_email', '${currentEmail}');
          sessionStorage.setItem('sv_salt', '${tempSalt}');
          sessionStorage.setItem('sv_tmp_mp', '${tempMasterPassword}');
          window.location.reload();
        `;
        
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (email, salt, mp) => {
            sessionStorage.setItem('sv_email', email);
            sessionStorage.setItem('sv_salt', salt);
            sessionStorage.setItem('sv_tmp_mp', mp);
            window.location.reload();
          },
          args: [currentEmail, tempSalt, tempMasterPassword]
        });

        // Nettoyage de la mémoire sensible après 2 secondes
        setTimeout(() => {
          tempMasterPassword = null;
          tempSalt = null;
        }, 2000);
      }
    });
  });
}

// Notification d'installation et ajout d'un badge pour la visibilité
chrome.runtime.onInstalled.addListener(() => {
  console.log("SecureVault Extension installée avec succès !");
  chrome.action.setBadgeText({ text: "SV" });
  chrome.action.setBadgeBackgroundColor({ color: "#F97316" });
});
