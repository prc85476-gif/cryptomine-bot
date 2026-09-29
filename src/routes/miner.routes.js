const express = require('express');
const router = express.Router();
const minerController = require('../controllers/minerController');

router.get('/active', minerController.getActiveMiner);
router.post('/mine', minerController.mineNow);
router.post('/upgrade', minerController.upgradeMiner);
router.post('/fast-forward', minerController.fastForwardMining);

module.exports = router;
