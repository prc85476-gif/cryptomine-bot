const dbService = require('../services/dbService');
const mockDatabase = require('../data/mockDatabase');

exports.getAllNFTs = async (req, res) => {
  try {
    const { rarity } = req.query;
    let items = mockDatabase.nftMarketplace;

    if (rarity && rarity !== "all") {
      items = items.filter(n => n.rarity.toLowerCase() === rarity.toLowerCase());
    }

    const purchasedIds = req.userId ? await dbService.getUserPurchasedNFTs(req.userId) : [];

    const mappedItems = items.map(n => {
      const cleanId = n.id.replace('nft-', '');
      const isPurchased = purchasedIds.includes(n.id) || purchasedIds.includes(cleanId) || purchasedIds.includes(`nft-${cleanId}`);
      return {
        ...n,
        isPurchased: isPurchased,
        isApproved: isPurchased
      };
    });

    return res.status(200).json({
      success: true,
      data: mappedItems,
      purchasedIds: purchasedIds,
      count: mappedItems.length
    });
  } catch (err) {
    console.error('nftController.getAllNFTs error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.buyNFT = async (req, res) => {
  try {
    const { nftId } = req.body;
    const nft = mockDatabase.nftMarketplace.find(n => n.id === nftId || n.id.replace('nft-', '') === String(nftId).replace('nft-', ''));

    if (!nft) {
      return res.status(404).json({ success: false, message: "NFT miner not found" });
    }

    // Check if user already owns / approved this miner plan
    const alreadyPurchased = await dbService.isNFTAlreadyPurchased(req.userId, nft.id);
    if (alreadyPurchased) {
      return res.status(400).json({
        success: false,
        isAlreadyOwned: true,
        message: `You have already purchased and activated ${nft.name}! This plan is already Approved and Active.`
      });
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

    // Get current active miner to combine existing daily rewards
    const currentMiner = await dbService.getActiveMiner(req.userId);
    const existingDaily = parseFloat(currentMiner?.dailyReward || user.miningRate || 0.0200);
    const newCombinedDailyRate = parseFloat((existingDaily + parseFloat(nft.dailyReward)).toFixed(4));

    const existingMax = parseFloat(currentMiner?.maxReward || 0.2000);
    const newCombinedMaxReward = parseFloat((existingMax + parseFloat(nft.totalReward)).toFixed(4));

    const combinedPrice = parseFloat(((currentMiner?.purchasePrice || 0) + nft.price).toFixed(2));
    const nowTime = Date.now();

    // Update user in Neon DB (miningRate set to combined daily rate)
    await dbService.updateUser(req.userId, {
      depositBalance: newDepositBal,
      balance: newMainBal,
      miningRate: newCombinedDailyRate
    });

    // Update active miner in Neon DB and reset 24h cycle timer to start from 00:00 (full 24h)
    const updatedMiner = await dbService.updateActiveMiner(req.userId, {
      miner_id: nft.id.replace('nft-', ''),
      name: nft.name,
      level: 1,
      rarity: nft.rarity,
      status: "Active",
      purchase_price: combinedPrice,
      daily_reward: newCombinedDailyRate,
      max_reward: newCombinedMaxReward,
      mining_days: nft.duration,
      power_hashrate: nft.hashrate,
      upgrade_cost: parseFloat((nft.price * 0.4).toFixed(2)),
      next_level: 2,
      next_level_reward: parseFloat((newCombinedDailyRate * 1.5).toFixed(4)),
      next_level_hashrate: `${Math.round(parseInt(nft.hashrate) * 1.6)} MH/s`,
      image: nft.image,
      cycle_start_time: nowTime
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

    // Record in user_purchased_miners table to prevent duplicate purchases
    await dbService.recordNFTPurchase(req.userId, nft);

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
