# 💎 CryptoMine - Telegram Mini App (NFT Mining Platform)

A modern, responsive, high-performance Telegram Mini App UI for an NFT Mining Platform built with **HTML5, CSS3 (Modern Glassmorphism & Cyberpunk Dark Theme), Vanilla JavaScript, and Node.js (Express Backend)**.

---

## 📸 Screenshots & Aesthetics
- **Theme**: Premium dark crypto style with navy/black background (`#060914`, `#080D1E`), neon blue, purple, cyan, and gold accents.
- **Mobile-first design**: Centered 430px smartphone frame on desktop browsers, and 100% full height inside the native Telegram Mobile App.
- **Micro-Animations & Audio**:
  - Live USDT mining balance increment ticker
  - Interactive "Mine Now" click with floating `+0.0030 USDT` particle burst & synthesized pickaxe sounds (via HTML5 Web Audio API)
  - Pulsing status badges, glowing border shimmers, and smooth bottom sheet modals

---

## 📂 Project Architecture (Path by Path)

```
c:\Users\User\Downloads\Telegram bot\
├── package.json                   # Express & dependencies
├── server.js                      # Main Express server entry point
├── src/
│   ├── routes/                    # Clean modular routing (path-by-path)
│   │   ├── api.js                 # Central API router aggregator
│   │   ├── user.routes.js         # User profile & settings (/api/user/*)
│   │   ├── miner.routes.js        # Active miner & mining boosts (/api/miner/*)
│   │   ├── nft.routes.js          # NFT marketplace & purchasing (/api/nft/*)
│   │   ├── premium.routes.js      # VIP plans & membership boosts (/api/premium/*)
│   │   ├── tasks.routes.js        # 7-day streak & missions (/api/tasks/*)
│   │   └── wallet.routes.js       # Deposit, withdraw & referrals (/api/wallet/*)
│   ├── controllers/               # Business logic controllers
│   │   ├── userController.js
│   │   ├── minerController.js
│   │   ├── nftController.js
│   │   ├── premiumController.js
│   │   ├── tasksController.js
│   │   └── walletController.js
│   └── data/
│       └── mockDatabase.js        # Reactive in-memory state store
└── public/
    ├── index.html                 # Main TMA single-page app container
    ├── css/                       # Modular CSS stylesheets
    │   ├── variables.css          # Design system tokens, glows & colors
    │   ├── base.css               # Reset, layout & mobile frame
    │   ├── header.css             # Header, logo, notification bell & nav
    │   ├── cards.css              # Total balance, miner card, grid & VIP banner
    │   ├── pages.css              # NFT shop, tasks, VIP plans & profile
    │   ├── modals.css             # Bottom sheets (Deposit, Withdraw, Referral, Upgrade)
    │   └── animations.css         # Keyframes, floating sparkles & hit shake
    ├── js/                        # Modular JavaScript files
    │   ├── telegram.js            # Telegram WebApp SDK & haptic feedback
    │   ├── api.js                 # Frontend API client
    │   ├── state.js               # Reactive client state store
    │   ├── mining.js              # Real-time balance ticker & Web Audio synth
    │   ├── nft.js                 # NFT marketplace rendering & purchase logic
    │   ├── premium.js             # VIP tiers & activation flow
    │   ├── tasks.js               # 7-day streak & missions claim handler
    │   ├── wallet.js              # Deposit QR, withdraw form & referral sharing
    │   ├── modals.js              # Bottom sheets & toast notification manager
    │   └── app.js                 # Main bootstrap & tab switching coordinator
    └── assets/
        └── images/                # 3D generated crypto collectible artwork
            ├── miner-1024.jpg     # Active Cyber Miner Level 2
            ├── pickaxe-crystal.jpg# Glowing Pickaxe header graphic
            ├── vip-banner.jpg     # 3D Gold VIP Pedestal & Crown
            ├── miner-plasma.jpg   # Neo Drone NFT (Rare)
            ├── miner-quantum.jpg  # Quantum Titan NFT (Epic)
            └── miner-auraxus.jpg  # Auraxus Dragon NFT (Legendary)
```

---

## 🚀 How to Run Locally

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Node.js Server**:
   ```bash
   npm start
   ```

3. **Open in Browser**:
   Open [http://localhost:3000](http://localhost:3000) to view the Telegram Mini App.

---

## 🤖 Deploying as a Telegram Mini App

1. Use a tunneling tool like `ngrok` or deploy to a cloud server (Vercel, Render, Railway, VPS):
   ```bash
   npx ngrok http 3000
   ```
2. Open Telegram and message [@BotFather](https://t.me/BotFather).
3. Send `/newapp`, select your bot, give your Mini App a title and short description.
4. When prompted for Web App URL, paste your HTTPS domain (e.g. `https://your-domain.ngrok-free.app`).
5. Open your Telegram bot and click the Menu button or web app link to launch!
