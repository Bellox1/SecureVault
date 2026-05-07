// Content script for SecureVault - Autofill logic
console.log("SecureVault Content Script actif.");

// Détecter les champs de type password sur la page
function detectLoginFields() {
  const passwordFields = document.querySelectorAll('input[type="password"]');
  
  if (passwordFields.length > 0) {
    console.log(`[SecureVault] ${passwordFields.length} champ(s) de mot de passe détecté(s).`);
    
    passwordFields.forEach(field => {
      // On pourrait injecter une icône S ici
      field.style.borderRight = "4px solid #F97316"; // Indicateur visuel BELLOX
      field.title = "Sécurisé par BELLOX DIGITAL";
    });
  }
}

// Exécuter la détection au chargement et lors de changements dans le DOM
function initObserver() {
  if (document.body) {
    detectLoginFields();
    const observer = new MutationObserver(detectLoginFields);
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    setTimeout(initObserver, 50);
  }
}
initObserver();

// Écouter les messages venant de l'extension pour l'autoremplissage
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FILL_CREDENTIALS") {
    const userField = document.querySelector('input[type="text"], input[type="email"]');
    const passField = document.querySelector('input[type="password"]');
    
    if (userField) userField.value = request.username;
    if (passField) passField.value = request.password;
    
    sendResponse({ success: true });
  }
});
