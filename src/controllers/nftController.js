const dbService = require('../services/dbService');
const mockDatabase = require('../data/mockDatabase');

exports.getAllNFTs = (req, res) => {
  try {
    const { rarity } = req.query;
    let items = mockDatabase.nftMarketplace;

    if (rarity && rarity !== "all") {
      items = items.filter(n => n.rarity.toLowerCase() === rarity.toLowerCase());
    }

    return res.status(200).json({
      success: true,
      data: items,
      count: items.length
    });
  } catch (err) {
    console.error('nftController.getAllNFTs error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.buyNFT = async (req, res) => {
  try {
    const { nftId } = req.body;
    const nft = mockDatabase.nftMarketplace.find(n => n.id === nftId);

    if (!nft) {
      return res.status(404).json({ success: false, message: "NFT miner not found" });
    }

    const user = await dbService.getUser(req.userId, req.userMeta);
    const userDepositBal = user.depositBalance || 0;
    const userMainBal = user.balance || 0;
    const totalAvailable = parseFloat((userDepositBal + userMainBal).toFixed(4));

    if (totalAvailable < nft.price) {
      return res.status(400).json({
        success: false,
        message: `Insufficient NFT Balance! ${nft.name} requires ${nft.price} USDT. Please deposit funds.`
      });
    }

    let newDepositBal = userDepositBal;
    let newMainBal = userMainBal;

    // Deduct from depositBalance (NFT Balance) first
    if (userDepositBal >= nft.price) {
      newDepositBal = parseFloat((userDepositBal - nft.price).toFixed(4));
    } else {
      const remainder = parseFloat((nft.price - userDepositBal).toFixed(4));
      newDepositBal = 0;
      newMainBal = parseFloat((userMainBal - remainder).toFixed(4));
    }

    // Update user in Neon DB
    await dbService.updateUser(req.userId, {
      depositBalance: newDepositBal,
      balance: newMainBal,
      miningRate: nft.dailyReward
    });

    // Update active miner in Neon DB and start 24h cycle
    const updatedMiner = await dbService.updateActiveMiner(req.userId, {
      miner_id: nft.id.replace('nft-', ''),
      name: nft.name,
      level: 1,
      rarity: nft.rarity,
      status: "Active",
      purchase_price: nft.price,
      daily_reward: nft.dailyReward,
      total_claim: 0.0000,
      total_reward: 0.0000,
      max_reward: nft.totalReward,
      mining_days: nft.duration,
      days_completed: 0,
      power_hashrate: nft.hashrate,
      upgrade_cost: parseFloat((nft.price * 0.4).toFixed(2)),
      next_level: 2,
      next_level_reward: parseFloat((nft.dailyReward * 1.5).toFixed(4)),
      next_level_hashrate: `${Math.round(parseInt(nft.hashrate) * 1.6)} MH/s`,
      image: nft.image,
      cycle_start_time: Date.now()
    });

    // Log transaction to Neon DB
    await dbService.addTransaction({
      id: `tx-${Date.now()}`,
      userId: req.userId,
      type: `Purchased ${nft.name}`,
      amount: `-${nft.price} USDT`,
      status: "Success",
      positive: false,
      date: "Just now"
    });

    // Distribute referral commission on NFT purchase
    dbService.distributeReferralCommission(req.userId, nft.price, 'NFT Purchase').catch((e) => {
      console.warn('Referral commission error on NFT buy:', e.message);
    });

    return res.status(200).json({
      success: true,
      message: `Congratulations! ${nft.name} successfully deployed and mining started!`,
      newBalance: newMainBal,
      depositBalance: newDepositBal,
      activeMiner: updatedMiner
    });
  } catch (err) {
    console.error('nftController.buyNFT error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
