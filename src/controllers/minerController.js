const dbService = require('../services/dbService');

const CYCLE_DURATION_MS = 24 * 3600 * 1000; // 24 Hours

function getProgressionRatio(elapsedMs) {
  if (elapsedMs >= CYCLE_DURATION_MS) return 1.0;
  if (elapsedMs <= 0) return 0.0;
  const t = elapsedMs / CYCLE_DURATION_MS;
  return Math.min(1.0, Math.max(0.0, (0.7 * t) + (0.3 * Math.sqrt(t))));
}

exports.getActiveMiner = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    let miner = await dbService.getActiveMiner(req.userId);

    if (!miner.cycleStartTime) {
      miner = await dbService.updateActiveMiner(req.userId, { cycleStartTime: Date.now() });
    }

    const now = Date.now();
    const elapsedMs = Math.max(0, now - miner.cycleStartTime);
    const isReady = elapsedMs >= CYCLE_DURATION_MS;
    const ratio = getProgressionRatio(elapsedMs);
    const progressPct = isReady ? 100 : Math.min(99.9, ratio * 100);
    const remainingMs = isReady ? 0 : CYCLE_DURATION_MS - elapsedMs;
    const dailyReward = miner.dailyReward * (user.vipPowerMultiplier || 1);
    const currentMined = isReady ? dailyReward : parseFloat((ratio * dailyReward).toFixed(6));
    const claimableAmount = isReady ? parseFloat(dailyReward.toFixed(4)) : 0;

    return res.status(200).json({
      success: true,
      data: {
        miner: {
          ...miner,
          totalReward: miner.totalClaim || miner.totalReward || 0.0500,
          totalClaim: miner.totalClaim || miner.totalReward || 0.0500
        },
        userBalance: user.balance,
        depositBalance: user.depositBalance,
        miningRate: user.miningRate,
        isMiningActive: true,
        cycle: {
          durationHours: 24,
          elapsedMs,
          remainingMs,
          progressPct: parseFloat(progressPct.toFixed(2)),
          currentMined,
          isReady,
          claimableAmount,
          cycleStartTime: miner.cycleStartTime
        }
      }
    });
  } catch (err) {
    console.error('minerController.getActiveMiner error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.mineNow = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    let miner = await dbService.getActiveMiner(req.userId);

    if (!miner.cycleStartTime) {
      miner = await dbService.updateActiveMiner(req.userId, { cycleStartTime: Date.now() });
    }

    const now = Date.now();
    const elapsedMs = Math.max(0, now - miner.cycleStartTime);
    const isReady = elapsedMs >= CYCLE_DURATION_MS || req.body.forceTest === true;
    const remainingMs = Math.max(0, CYCLE_DURATION_MS - elapsedMs);

    if (!isReady) {
      return res.status(200).json({
        success: false,
        canClaim: false,
        message: "Mining in progress! Reward not claimable yet. Complete 24h cycle to claim.",
        remainingMs,
        dailyReward: miner.dailyReward,
        claimableAmount: 0
      });
    }

    // Process Full 24-Hour Reward Claim
    const dailyReward = miner.dailyReward;
    const multiplier = user.vipPowerMultiplier || 1;
    const totalClaimReward = parseFloat((dailyReward * multiplier).toFixed(4));

    // Update user balance (credited to withdrawable balance) & total earned in Neon DB
    const newBalance = parseFloat((user.balance + totalClaimReward).toFixed(4));
    const newTotalEarned = parseFloat((user.totalEarned + totalClaimReward).toFixed(4));
    await dbService.updateUser(req.userId, {
      balance: newBalance,
      totalEarned: newTotalEarned
    });

    // Update active miner stats & reset cycle timer in Neon DB
    const newTotalClaim = parseFloat(((miner.totalClaim || 0) + totalClaimReward).toFixed(4));
    const updatedMiner = await dbService.updateActiveMiner(req.userId, {
      totalClaim: newTotalClaim,
      totalReward: newTotalClaim,
      cycleStartTime: Date.now()
    });

    // Add transaction log in Neon DB
    await dbService.addTransaction({
      id: `tx-${Date.now()}`,
      userId: req.userId,
      type: "Daily Mining Claim (24h)",
      amount: `+${totalClaimReward.toFixed(4)} USDT`,
      status: "Success",
      positive: true,
      date: "Just now"
    });

    return res.status(200).json({
      success: true,
      canClaim: true,
      message: `Mining reward successfully claimed! (+${totalClaimReward.toFixed(4)} USDT)`,
      reward: totalClaimReward,
      newBalance: newBalance,
      totalClaim: newTotalClaim,
      totalReward: newTotalClaim,
      activeMiner: updatedMiner,
      cycleStartTime: updatedMiner.cycleStartTime
    });
  } catch (err) {
    console.error('minerController.mineNow error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.fastForwardMining = async (req, res) => {
  try {
    const updatedMiner = await dbService.updateActiveMiner(req.userId, {
      cycleStartTime: Date.now() - (CYCLE_DURATION_MS + 1000)
    });

    return res.status(200).json({
      success: true,
      message: "24-Hour Mining Cycle is now completed and ready to claim!",
      cycleStartTime: updatedMiner.cycleStartTime,
      claimableReward: updatedMiner.dailyReward
    });
  } catch (err) {
    console.error('minerController.fastForwardMining error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.upgradeMiner = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    const miner = await dbService.getActiveMiner(req.userId);
    const cost = miner.upgradeCost;

    const userDepositBal = user.depositBalance || 0;
    const userMainBal = user.balance || 0;
    const totalAvailable = parseFloat((userDepositBal + userMainBal).toFixed(4));

    if (totalAvailable < cost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient NFT balance! You need ${cost} USDT to upgrade. Please deposit funds.`
      });
    }

    let newDepositBal = userDepositBal;
    let newMainBal = userMainBal;

    // Deduct from depositBalance (NFT Balance) first
    if (userDepositBal >= cost) {
      newDepositBal = parseFloat((userDepositBal - cost).toFixed(4));
    } else {
      const remainder = parseFloat((cost - userDepositBal).toFixed(4));
      newDepositBal = 0;
      newMainBal = parseFloat((userMainBal - remainder).toFixed(4));
    }

    const nextLevel = miner.level + 1;
    const nextDailyReward = miner.nextLevelReward;
    const nextPowerHashrate = miner.nextLevelHashrate;
    const nextUpgradeCost = parseFloat((cost * 1.6).toFixed(2));
    const nextNextLevel = nextLevel + 1;
    const nextNextReward = parseFloat((nextDailyReward * 1.45).toFixed(4));
    const nextNextHashrate = `${Math.round(parseInt(nextPowerHashrate) * 1.55)} MH/s`;

    // Update user balance in Neon DB
    await dbService.updateUser(req.userId, {
      depositBalance: newDepositBal,
      balance: newMainBal,
      miningRate: nextDailyReward
    });

    // Update miner in Neon DB
    const updatedMiner = await dbService.updateActiveMiner(req.userId, {
      level: nextLevel,
      dailyReward: nextDailyReward,
      powerHashrate: nextPowerHashrate,
      upgradeCost: nextUpgradeCost,
      nextLevel: nextNextLevel,
      nextLevelReward: nextNextReward,
      nextLevelHashrate: nextNextHashrate
    });

    // Record transaction in Neon DB
    await dbService.addTransaction({
      id: `tx-${Date.now()}`,
      userId: req.userId,
      type: `Upgrade to Level ${nextLevel}`,
      amount: `-${cost.toFixed(2)} USDT`,
      status: "Success",
      positive: false,
      date: "Just now"
    });

    return res.status(200).json({
      success: true,
      message: `Miner successfully upgraded to Level ${nextLevel}!`,
      activeMiner: updatedMiner,
      newBalance: newMainBal,
      depositBalance: newDepositBal,
      miningRate: nextDailyReward
    });
  } catch (err) {
    console.error('minerController.upgradeMiner error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
