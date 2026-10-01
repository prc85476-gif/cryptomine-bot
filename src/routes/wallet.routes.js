const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

router.get('/details', walletController.getWalletDetails);
router.post('/deposit-intent', walletController.createDepositIntent);
router.get('/deposit-status', walletController.checkDepositStatus);
router.post('/deposit', walletController.deposit);
router.post('/verify-deposit-tx', walletController.verifyDepositTx);
router.post('/withdraw', walletController.withdraw);
router.get('/referral', walletController.getReferralInfo);

module.exports = router;
