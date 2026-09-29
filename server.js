require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const mainBotService = require('./src/services/mainBotService');
const telegramBotService = require('./src/services/telegramBotService');
const initDatabase = require('./src/data/initDatabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', apiRoutes);

// Fallback for SPA routing - serve index.html for unknown non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint not found' });
  }
});

// Bootstrap Database & Server
async function startServer() {
  try {
    // 1. Initialize Neon PostgreSQL Database
    await initDatabase();

    // 2. Start Express Server
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 CryptoMine Telegram Mini App Server is running!`);
      console.log(`🐘 Neon PostgreSQL: Connected & Synced`);
      console.log(`📡 Local URL: http://localhost:${PORT}`);
      console.log(`💎 API Base: http://localhost:${PORT}/api`);
      console.log(`⚡ Ready for Telegram Mini App & Web Browsers`);
      console.log(`====================================================`);

      // 3. Initialize Main User Bot (Mint NFT & /start)
      mainBotService.init();

      // 4. Initialize Admin Notification & Payout Bot
      telegramBotService.init();
    });
  } catch (err) {
    console.error('❌ Failed to start server due to Database error:', err);
    process.exit(1);
  }
}

startServer();
