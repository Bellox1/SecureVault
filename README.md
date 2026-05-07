# 🔐 SecureVault - Zero-Knowledge Password Manager

**SecureVault** est un gestionnaire de mots de passe professionnel ultra-sécurisé reposant sur une architecture **Zero-Knowledge**. Développé par **BELLOX DIGITAL**, il garantit que seul l'utilisateur final possède les clés pour déchiffrer ses données. Le serveur ne manipule que des données chiffrées (AES-GCM) et des hashes d'authentification (Argon2).

---

## 🌟 Points Forts

-   **Architecture Zero-Knowledge** : Le serveur ne connaît jamais votre mot de passe maître.
-   **Chiffrement de Pointe** : Utilisation de l'API `WebCrypto` (AES-256-GCM) pour toutes les opérations clients.
-   **Double Authentification (2FA)** : Support TOTP (Google Authenticator, Bitwarden, etc.) avec QR Code.
-   **Supervision Admin** : Tableau de bord pour surveiller l'activité et les erreurs critiques du système.
-   **Design "Quiet Luxury"** : Interface moderne, fluide et responsive pour une expérience utilisateur premium.
-   **Import/Export** : Support des formats JSON, CSV et génération de PDF sécurisés.

---

## 📁 Structure du Projet

```text
Memory/
├── backend/            # API REST Express & Base de données SQLite
├── frontend/           # Interface SPA (HTML/CSS/JS Vanilla)
└── README.md           # Documentation globale
```

---

## 🚀 Installation Rapide

### 1. Prérequis
- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)

### 2. Configuration du Backend
```bash
cd backend
npm install
# Créez votre fichier .env basé sur .env.example
npm start
```

### 3. Accès au Frontend
Le frontend est servi par le serveur backend sur `http://localhost:3001`.

---

## 🔒 Sécurité & Confidentialité

Tous les calculs cryptographiques sensibles (dérivation de clé via PBKDF2, chiffrement AES-256-GCM) sont effectués exclusivement côté client. En cas de changement de mot de passe maître, tout le coffre est ré-encrypté localement avant d'être synchronisé avec le serveur.

---
Développé par BELLOX DIGITAL
