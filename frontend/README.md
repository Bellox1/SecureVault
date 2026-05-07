# 🎨 SecureVault Frontend

L'interface utilisateur premium et sécurisée de SecureVault.

## 🌈 Design System : "Quiet Luxury"
Le frontend utilise un design épuré, typique des applications de haute technologie :
- **Couleurs** : Noir, Blanc, et Bleu Bellox.
- **Typographie** : Inter / Outfit (sans-serif moderne).
- **Composants** : Verre dépoli (glassmorphism), ombres premium, et micro-animations.

## 🔐 Logique Cryptographique
Tout le chiffrement est géré dans `js/crypto.js` via l'API standard **WebCrypto** des navigateurs modernes :
- **AES-256-GCM** pour le chiffrement des données.
- **PBKDF2** pour la dérivation des clés.
- **Argon2 (via WASM)** pour le hachage d'authentification.

## 📂 Organisation
- `index.html` : Landing page professionnelle.
- `app.html` : Interface principale du coffre-fort (SPA).
- `js/app.js` : Contrôleur principal de l'application.
- `js/api.js` : Client API pour la communication avec le backend.

---
**Développé par BELLOX DIGITAL**
