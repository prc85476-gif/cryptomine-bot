const express = require('express');
const router = express.Router();
const userContext = require('../middleware/userContext');

const userRoutes = require('./user.routes');
const minerRoutes = require('./miner.routes');
const nftRoutes = require('./nft.routes');
const premiumRoutes = require('./premium.routes');
const tasksRoutes = require('./tasks.routes');
const walletRoutes = require('./wallet.routes');

// Apply user context middleware to all API routes
router.use(userContext);

// Mount API routes
router.use('/user', userRoutes);
router.use('/miner', minerRoutes);
router.use('/nft', nftRoutes);
router.use('/premium', premiumRoutes);
router.use('/tasks', tasksRoutes);
router.use('/wallet', walletRoutes);

router.get('/health', (req, res) => {
  res.json({
    status: "ok",
    app: "CryptoMine Telegram Mini App API",
    version: "1.0.0",
    database: "Neon PostgreSQL (Connected)",
    time: new Date().toISOString()
  });
});

module.exports = router;
