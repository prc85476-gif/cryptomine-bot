const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/bootstrap', userController.getBootstrapData);
router.get('/profile', userController.getProfile);
router.post('/settings', userController.updateSettings);
router.post('/claim-gift', userController.claimGiftBox);
router.get('/gift-info', userController.getGiftBoxInfo);

module.exports = router;
