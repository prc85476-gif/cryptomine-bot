const dbService = require('../services/dbService');
const telegramBotService = require('../services/telegramBotService');
const mainBotService = require('../services/mainBotService');
const depositWatcherService = require('../services/depositWatcherService');
const { ethers } = require('ethers');

exports.getWalletDetails = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    const transactions = await dbService.getTransactions(req.userId, 50);
    const hasFastMiner = await dbService.hasFastMiner(req.userId);

    return res.status(200).json({
      success: true,
      balance: user.balance,
      depositBalance: user.depositBalance,
      tonBalance: user.tonBalance,
      totalEarned: user.totalEarned,
      totalWithdrawn: user.totalWithdrawn,
      totalDeposited: user.totalDeposited,
      walletAddress: user.walletAddress,
      hasFastMiner: hasFastMiner,
      transactions: transactions
    });
  } catch (err) {
    console.error('walletController.getWalletDetails error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Register a deposit intent with a deterministic unique decimal amount
 */
exports.createDepositIntent = async (req, res) => {
  try {
    const { amount, network } = req.body;
    const baseAmt = parseFloat(amount) || 3.0;

    if (baseAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid deposit amount' });
    }

    const user = await dbService.getUser(req.userId, req.userMeta);
    const intent = depositWatcherService.registerIntent({
      userId: req.userId,
      telegramId: user.telegramId || req.userId,
      username: user.username || user.name || 'Miner',
      baseAmount: baseAmt,
      network: network || 'USDT BEP20'
    });

    return res.status(200).json({
      success: true,
      exactAmount: intent.exactAmount,
      baseAmount: intent.baseAmount,
      network: intent.network,
      depositAddress: intent.depositAddress,
      expiresAt: intent.expiresAt
    });
  } catch (err) {
    console.error('walletController.createDepositIntent error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Check if the active deposit intent has arrived and verified on-chain
 */
exports.checkDepositStatus = async (req, res) => {
  try {
    const status = await depositWatcherService.checkStatus(req.userId);
    return res.status(200).json({
      success: true,
      ...status
    });
  } catch (err) {
    console.error('walletController.checkDepositStatus error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.deposit = async (req, res) => {
  try {
    // Deposits are strictly validated through on-chain blockchain monitoring
    const status = await depositWatcherService.checkStatus(req.userId);
    if (!status || !status.confirmed) {
      return res.status(400).json({
        success: false,
        error: "UNVERIFIED_DEPOSIT",
        message: "No confirmed on-chain deposit found. Please transfer the exact USDT amount to the provided deposit address and wait for BSC block confirmation."
      });
    }

    const user = await dbService.getUser(req.userId, req.userMeta);
    return res.status(200).json({
      success: true,
      message: `On-chain deposit confirmed! +${status.baseAmount} USDT credited to your account.`,
      newBalance: user.balance,
      depositBalance: user.depositBalance,
      totalDeposited: user.totalDeposited,
      txHash: status.txHash
    });
  } catch (err) {
    console.error('walletController.deposit error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.withdraw = async (req, res) => {
  try {
    const { amount, address, network, turnstileToken } = req.body;
    const withdrawAmt = parseFloat(amount);
    const selectedNet = network || 'USDT BEP20';
    const isBep20 = selectedNet.toUpperCase().includes('BEP20');
    const minAmt = isBep20 ? 0.15 : 10.0;
    const fee = isBep20 ? 0.005 : 1.0;

    if (!withdrawAmt || withdrawAmt < minAmt) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount for ${selectedNet} is ${minAmt} USDT`
      });
    }

    const user = await dbService.getUser(req.userId, req.userMeta);

    if (user.balance < withdrawAmt) {
      return res.status(400).json({
        success: false,
        message: `Insufficient withdrawable balance! Your current balance is ${user.balance.toFixed(4)} USDT.`
      });
    }

    const trimmedAddress = (address || '').trim();
    if (!trimmedAddress || trimmedAddress.length < 5) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid crypto withdrawal address"
      });
    }

    if (isBep20 && !ethers.isAddress(trimmedAddress)) {
      return res.status(400).json({
        success: false,
        message: "Invalid BEP-20 (BSC) wallet address format! Address must be a valid 42-character 0x... address."
      });
    }

    const currentSavedAddr = (user.walletAddress && !user.walletAddress.includes('...')) ? user.walletAddress.trim() : null;

    // Daily Withdrawal Limit check (Free/Starter: 2 times daily. Fast Miner/Purchased: 5 times daily)
    const isFastMiner = await dbService.hasFastMiner(req.userId);

    // Rule: If an address was already saved and the user attempts to enter a different address:
    // Only users with an active purchased miner / deposit / fast plan are allowed to change withdrawal address!
    if (currentSavedAddr && currentSavedAddr.toLowerCase() !== trimmedAddress.toLowerCase()) {
      if (!isFastMiner) {
        return res.status(400).json({
          success: false,
          requiresPlan: true,
          message: "To change your withdrawal wallet address, you must purchase a mining plan."
        });
      }
    }

    const defaultLimit = isFastMiner ? 5 : 2;
    const dailyLimit = (user.dailyWithdrawLimit !== null && user.dailyWithdrawLimit !== undefined && user.dailyWithdrawLimit >= 0)
      ? user.dailyWithdrawLimit
      : defaultLimit;
    const todayCount = await dbService.getDailyWithdrawalCount(req.userId);

    if (todayCount >= dailyLimit) {
      const limitMsg = (user.dailyWithdrawLimit !== null && user.dailyWithdrawLimit !== undefined)
        ? `Daily withdrawal limit reached (${todayCount}/${dailyLimit} times). You have used all daily withdrawals allocated for today.`
        : (isFastMiner
            ? `Daily withdrawal limit reached (${dailyLimit}/${dailyLimit} times). You have used all 5 daily withdrawals for today.`
            : `Daily limit reached (${dailyLimit}/${dailyLimit} times). Purchase a fast mining NFT to increase your daily withdrawal limit to 5 times!`);

      return res.status(400).json({
        success: false,
        dailyLimitReached: true,
        currentCount: todayCount,
        maxLimit: dailyLimit,
        message: limitMsg
      });
    }

    // Cloudflare Turnstile Verification (if provided)
    if (turnstileToken) {
      try {
        const cfSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
        if (cfSecret) {
          const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${encodeURIComponent(cfSecret)}&response=${encodeURIComponent(turnstileToken)}`
          });
          const cfData = await verifyRes.json();
          if (cfData && cfData.success === false) {
            console.warn('Turnstile verification failed:', cfData);
          }
        }
      } catch (err) {
        console.warn('Turnstile verification request error:', err.message);
      }
    }

    const finalReceived = parseFloat(Math.max(0, withdrawAmt - fee).toFixed(4));
    const txId = `tx-${Date.now()}`;

    // Atomic Database Deduction with zero race-condition window
    const userUpdates = {};
    if (!currentSavedAddr || currentSavedAddr.toLowerCase() !== trimmedAddress.toLowerCase()) {
      userUpdates.walletAddress = trimmedAddress;
    }

    const updatedUser = await dbService.atomicDeductBalance(req.userId, withdrawAmt, userUpdates);
    if (!updatedUser) {
      return res.status(400).json({
        success: false,
        message: "Insufficient withdrawable balance or withdrawal conflict. Please refresh and try again."
      });
    }

    const newBalance = updatedUser.balance;
    const newTotalWithdrawn = updatedUser.totalWithdrawn;

    // Add Pending Transaction in Neon Database
    await dbService.addTransaction({
      id: txId,
      userId: req.userId,
      type: `Withdraw (${selectedNet})`,
      amount: `-${withdrawAmt.toFixed(4)} USDT`,
      recipientAddress: trimmedAddress,
      network: selectedNet,
      status: "Pending",
      positive: false,
      date: "Processing"
    });

    // 1. Send instant 1-line notification to the USER's Telegram
    mainBotService.notifyUserWithdrawalPending(user.telegramId, withdrawAmt).catch(() => {});

    // Gather full user profile & stats for admin withdrawal request alert
    const [activeMiner, purchasedNFTs, referrals] = await Promise.all([
      dbService.getActiveMiner(req.userId).catch(() => null),
      dbService.getUserPurchasedNFTs(req.userId).catch(() => []),
      dbService.getReferrals(req.userId).catch(() => [])
    ]);

    const activeMinersCount = purchasedNFTs.length > 0 
      ? (new Set(purchasedNFTs.map(id => String(id).replace('nft-', '')))).size
      : 1;

    const totalBalance = parseFloat((newBalance + (user.depositBalance || 0)).toFixed(4));

    // 2. Notify Telegram Admin Bot with full user details & Approve / Reject action & Ban button
    telegramBotService.notifyWithdrawalRequest({
      txId,
      userId: user.telegramId,
      username: user.username,
      name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Miner',
      amount: withdrawAmt,
      fee,
      finalReceived,
      address: trimmedAddress,
      network: selectedNet,
      mainBalance: newBalance,
      depositBalance: user.depositBalance || 0,
      totalBalance: totalBalance,
      totalWithdrawn: newTotalWithdrawn,
      totalDeposited: user.totalDeposited || 0,
      totalReferrals: referrals.length,
      activeMinersCount: activeMinersCount,
      minerName: activeMiner?.name || 'Cyber Bot #1024',
      miningRate: user.miningRate || activeMiner?.dailyReward || 0.0200
    }).catch((botErr) => {
      console.warn('Could not dispatch Telegram alert:', botErr.message);
    });

    return res.status(200).json({
      success: true,
      message: `Withdrawal of ${withdrawAmt.toFixed(4)} USDT submitted! Sent to admin for approval. Net receiving: ${finalReceived.toFixed(4)} USDT.`,
      newBalance: newBalance,
      totalWithdrawn: newTotalWithdrawn,
      walletAddress: trimmedAddress,
      hasFastMiner: isFastMiner,
      txId
    });
  } catch (err) {
    console.error('walletController.withdraw error:', err);
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  }
};

exports.getReferralInfo = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    const refData = await dbService.getReferrals(req.userId);
    const botUsername = process.env.BOT_USERNAME || 'cryptomintnftbot';

    return res.status(200).json({
      success: true,
      referralCode: user.referralCode,
      referralLink: `https://t.me/${botUsername}?start=${user.referralCode}`,
      invitedCount: refData.invitedCount,
      totalEarnings: refData.totalEarnings,
      commissionRates: {
        tier1: "10%",
        tier2: "5%",
        tier3: "2%"
      },
      referralList: refData.referralsList
    });
  } catch (err) {
    console.error('walletController.getReferralInfo error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
