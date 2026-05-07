# ⚙️ SecureVault Backend

Le moteur de stockage et d'authentification de SecureVault. Conçu pour être minimaliste, sécurisé et performant.

## 🛠 Technologies
- **Express.js** : Serveur web.
- **SQLite3** : Base de données légère et embarquée.
- **Argon2** : Hachage ultra-sécurisé des mots de passe.
- **JWT (Json Web Token)** : Gestion des sessions via cookies HTTP-only.
- **OTPLib** : Gestion des codes TOTP/2FA.
- **Nodemailer** : Service d'envoi d'emails.
- **Winston** : Journalisation avancée (Logs).

## 🚀 Configuration
Assurez-vous d'avoir un fichier `.env` à la racine de ce dossier avec les variables suivantes :
- `JWT_SECRET` : Clé secrète robuste pour les jetons.
- `EMAIL_USER` / `EMAIL_PASS` : Identifiants SMTP (Gmail recommandé).
- `NODE_ENV` : `development` ou `production`.

## 📜 Scripts
- `npm start` : Démarre le serveur sur le port 3001.
- `npm run dev` : Démarre le serveur avec Nodemon pour le développement.

---
**Développé par BELLOX DIGITAL**
