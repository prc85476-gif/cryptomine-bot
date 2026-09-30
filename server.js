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
const rateLimiter = require('./src/middleware/rateLimiter');

// Security Hardening: Disable X-Powered-By header
app.disable('x-powered-by');

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Apply rate limiting to all API endpoints (120 requests per minute)
app.use('/api', rateLimiter({ windowMs: 60 * 1000, max: 120 }));

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

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
