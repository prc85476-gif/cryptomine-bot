const dbService = require('../services/dbService');
const mockDatabase = require('../data/mockDatabase');

exports.getVIPPlans = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    return res.status(200).json({
      success: true,
      currentTier: user.vipTier,
      powerMultiplier: user.vipPowerMultiplier,
      plans: mockDatabase.vipPlans
    });
  } catch (err) {
    console.error('premiumController.getVIPPlans error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.activateVIP = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = mockDatabase.vipPlans.find(p => p.id === planId);

    if (!plan) {
      return res.status(404).json({ success: false, message: "VIP plan not found" });
    }

    const user = await dbService.getUser(req.userId, req.userMeta);
    const userDepositBal = user.depositBalance || 0;
    const userMainBal = user.balance || 0;
    const totalAvailable = parseFloat((userDepositBal + userMainBal).toFixed(4));

    if (totalAvailable < plan.price) {
      return res.status(400).json({
        success: false,
        message: `Insufficient NFT Balance! ${plan.name} requires ${plan.price} USDT. Please deposit funds.`
      });
    }

    let newDepositBal = userDepositBal;
    let newMainBal = userMainBal;

    // Deduct from depositBalance (NFT Balance) first
    if (userDepositBal >= plan.price) {
      newDepositBal = parseFloat((userDepositBal - plan.price).toFixed(4));
    } else {
      const remainder = parseFloat((plan.price - userDepositBal).toFixed(4));
      newDepositBal = 0;
      newMainBal = parseFloat((userMainBal - remainder).toFixed(4));
    }

    // Update user in Neon DB
    await dbService.updateUser(req.userId, {
      depositBalance: newDepositBal,
      balance: newMainBal,
      vipTier: plan.name,
      vipPowerMultiplier: plan.multiplier
    });

    // Log transaction in Neon DB
    await dbService.addTransaction({
      id: `tx-${Date.now()}`,
      userId: req.userId,
      type: `Activated ${plan.name}`,
      amount: `-${plan.price} USDT`,
      status: "Success",
      positive: false,
      date: "Just now"
    });

    return res.status(200).json({
      success: true,
      message: `VIP Activated! Enjoy ${plan.multiplier}x Mining Speed & exclusive rewards!`,
      vipTier: plan.name,
      newBalance: newMainBal,
      depositBalance: newDepositBal,
      multiplier: plan.multiplier
    });
  } catch (err) {
    console.error('premiumController.activateVIP error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
