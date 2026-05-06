# SecureVault - Architecture Zero-Knowledge

## Stack Technique
- **Frontend**: HTML5 + CSS3 + Vanilla JS (Web Crypto API natif)
- **Backend**: Node.js + Express.js
- **Base de données**: SQLite (better-sqlite3)
- **Crypto Frontend**: Web Crypto API (AES-256-GCM, PBKDF2)
- **Crypto Backend**: argon2 pour hash du master password
- **Auth**: JWT (httpOnly cookies) + CSRF tokens

## Structure du projet
```
Memory/
├── backend/
│   ├── server.js          # Express app + middlewares sécurité
│   ├── database.js        # SQLite setup
│   ├── routes/
│   │   ├── auth.js        # Inscription/Connexion
│   │   └── vault.js       # CRUD vault items
│   ├── middleware/
│   │   ├── auth.js        # JWT verification
│   │   └── rateLimiter.js # Rate limiting
│   └── package.json
└── frontend/
    ├── index.html         # Landing page
    ├── app.html           # Application principale
    ├── css/
    │   └── style.css      # Styles globaux
    └── js/
        ├── crypto.js      # Chiffrement AES-256-GCM + PBKDF2
        ├── api.js         # Appels API
        └── app.js         # Logique applicative
```
