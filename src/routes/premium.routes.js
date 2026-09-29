const express = require('express');
const router = express.Router();
const premiumController = require('../controllers/premiumController');

router.get('/plans', premiumController.getVIPPlans);
router.post('/activate', premiumController.activateVIP);

module.exports = router;
