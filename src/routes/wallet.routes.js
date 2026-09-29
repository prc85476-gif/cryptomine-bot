const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

router.get('/details', walletController.getWalletDetails);
router.post('/deposit', walletController.deposit);
router.post('/withdraw', walletController.withdraw);
router.get('/referral', walletController.getReferralInfo);

module.exports = router;
