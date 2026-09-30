const express = require('express');
const router = express.Router();
const nftController = require('../controllers/nftController');

router.get('/', nftController.getAllNFTs);
router.get('/list', nftController.getAllNFTs);
router.post('/buy', nftController.buyNFT);

module.exports = router;
