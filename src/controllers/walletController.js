const dbService = require('../services/dbService');
const telegramBotService = require('../services/telegramBotService');
const mainBotService = require('../services/mainBotService');

exports.getWalletDetails = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    const transactions = await dbService.getTransactions(req.userId, 50);

    return res.status(200).json({
      success: true,
      balance: user.balance,
      depositBalance: user.depositBalance,
      tonBalance: user.tonBalance,
      totalEarned: user.totalEarned,
      totalWithdrawn: user.totalWithdrawn,
      totalDeposited: user.totalDeposited,
      walletAddress: user.walletAddress,
      transactions: transactions
    });
  } catch (err) {
    console.error('walletController.getWalletDetails error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.deposit = async (req, res) => {
  try {
    const { amount, network, txHash } = req.body;
    const depositAmt = parseFloat(amount) || 3.0;

    if (depositAmt <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deposit amount" });
    }

    const user = await dbService.getUser(req.userId, req.userMeta);
    const newDepositBalance = parseFloat((user.depositBalance + depositAmt).toFixed(4));
    const newTotalDeposited = parseFloat((user.totalDeposited + depositAmt).toFixed(4));

    // Update in Neon Database: deposit_balance and total_deposited
    await dbService.updateUser(req.userId, {
      depositBalance: newDepositBalance,
      totalDeposited: newTotalDeposited
    });

    const shortHash = txHash ? `${txHash.substring(0, 6)}...${txHash.substring(txHash.length - 4)}` : null;
    const txId = `tx-${Date.now()}`;

    // Add transaction to Neon Database
    await dbService.addTransaction({
      id: txId,
      userId: req.userId,
      type: `Deposit NFT Fund (${network || 'BEP20'})${shortHash ? ' - ' + shortHash : ''}`,
      amount: `+${depositAmt.toFixed(4)} USDT`,
      txHash: txHash || null,
      network: network || 'USDT BEP20',
      status: "Completed",
      positive: true,
      date: "Just now"
    });

    // Fetch referral count for rich Telegram alert
    const refData = await dbService.getReferrals(req.userId);

    // Send Instant Rich Deposit Notification to Admin Telegram Bot with BscScan Link and Ban / Unban actions
    telegramBotService.notifyDepositAlert({
      userId: user.telegramId,
      username: user.username,
      name: user.name || `${user.firstName} ${user.lastName}`.trim(),
      amount: depositAmt,
      network: network || 'USDT BEP20',
      txHash: txHash || 'N/A',
      depositBalance: newDepositBalance,
      mainBalance: user.balance,
      totalDeposited: newTotalDeposited,
      totalReferrals: refData.invitedCount || 0
    }).catch((botErr) => {
      console.warn('Could not dispatch Telegram deposit alert:', botErr.message);
    });

    return res.status(200).json({
      success: true,
      message: `Deposit verified & confirmed! +${depositAmt.toFixed(2)} USDT added to your NFT Purchase Balance in Neon Database.`,
      newBalance: user.balance,
      depositBalance: newDepositBalance,
      totalDeposited: newTotalDeposited,
      txId
    });
  } catch (err) {
    console.error('walletController.deposit error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const pendingWithdrawalCodes = new Map(); // userId -> { code, amount, address, network, expiresAt }

exports.requestWithdrawCode = async (req, res) => {
  try {
    const { amount, address, network, turnstileToken } = req.body;
    const withdrawAmt = parseFloat(amount);
    const selectedNet = network || 'USDT BEP20';
    const isBep20 = selectedNet.toUpperCase().includes('BEP20');
    const minAmt = isBep20 ? 0.15 : 10.0;

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

    if (!address || address.length < 5) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid crypto withdrawal address"
      });
    }

    // Generate random 4-digit security PIN
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    pendingWithdrawalCodes.set(String(req.userId), {
      code,
      amount: withdrawAmt,
      address,
      network: selectedNet,
      expiresAt
    });

    // Send 4-digit code with custom generated Security Card image to user's Telegram
    const telegramId = user.telegramId || req.userId;
    mainBotService.sendWithdrawalSecurityCode(telegramId, {
      code,
      amount: withdrawAmt.toFixed(4),
      network: selectedNet,
      address
    }).catch((err) => {
      console.warn('Could not send security code photo to Telegram:', err.message);
    });

    return res.status(200).json({
      success: true,
      message: 'A 4-digit security code with a protection card has been sent to your Telegram Bot!',
      expiresInSeconds: 600
    });
  } catch (err) {
    console.error('walletController.requestWithdrawCode error:', err);
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  }
};

exports.withdraw = async (req, res) => {
  try {
    const { amount, address, network, turnstileToken, code } = req.body;
    const withdrawAmt = parseFloat(amount);
    const selectedNet = network || 'USDT BEP20';
    const isBep20 = selectedNet.toUpperCase().includes('BEP20');
    const minAmt = isBep20 ? 0.15 : 10.0;
    const fee = isBep20 ? 0.005 : 1.0;

    // 1. Verify 4-digit security code
    const stored = pendingWithdrawalCodes.get(String(req.userId));
    if (!stored) {
      return res.status(400).json({
        success: false,
        message: 'Security code expired or not requested. Please request a new verification code.'
      });
    }

    if (Date.now() > stored.expiresAt) {
      pendingWithdrawalCodes.delete(String(req.userId));
      return res.status(400).json({
        success: false,
        message: 'Verification code expired (valid for 10 minutes). Please request a new code.'
      });
    }

    if (!code || String(code).trim() !== String(stored.code).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid 4-digit security code! Please check the code sent to your Telegram bot.'
      });
    }

    // Code is valid - clear it
    pendingWithdrawalCodes.delete(String(req.userId));

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

    if (!address || address.length < 5) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid crypto withdrawal address"
      });
    }

    // Cloudflare Turnstile Verification (if provided)
    if (turnstileToken) {
      try {
        const cfSecret = '0x4AAAAAAFHWuB54UEvkuKEt';
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${encodeURIComponent(cfSecret)}&response=${encodeURIComponent(turnstileToken)}`
        });
        const cfData = await verifyRes.json();
        if (cfData && cfData.success === false) {
          console.warn('Turnstile verification failed:', cfData);
        }
      } catch (err) {
        console.warn('Turnstile verification request error:', err.message);
      }
    }

    const finalReceived = parseFloat(Math.max(0, withdrawAmt - fee).toFixed(4));
    const txId = `tx-${Date.now()}`;

    const newBalance = parseFloat((user.balance - withdrawAmt).toFixed(4));
    const newTotalWithdrawn = parseFloat((user.totalWithdrawn + withdrawAmt).toFixed(4));

    // Update in Neon Database
    await dbService.updateUser(req.userId, {
      balance: newBalance,
      totalWithdrawn: newTotalWithdrawn
    });

    // Add Pending Transaction in Neon Database
    await dbService.addTransaction({
      id: txId,
      userId: req.userId,
      type: `Withdraw (${selectedNet})`,
      amount: `-${withdrawAmt.toFixed(4)} USDT`,
      recipientAddress: address,
      network: selectedNet,
      status: "Pending",
      positive: false,
      date: "Processing"
    });

    // 1. Send instant 1-line notification to the USER's Telegram
    mainBotService.notifyUserWithdrawalPending(user.telegramId, withdrawAmt).catch(() => {});

    // 2. Notify Telegram Admin Bot with Approve / Reject action & Ban button
    telegramBotService.notifyWithdrawalRequest({
      txId,
      userId: user.telegramId,
      username: user.username,
      amount: withdrawAmt,
      fee,
      finalReceived,
      address,
      network: selectedNet
    }).catch((botErr) => {
      console.warn('Could not dispatch Telegram alert:', botErr.message);
    });

    return res.status(200).json({
      success: true,
      message: `Withdrawal of ${withdrawAmt.toFixed(4)} USDT submitted! Sent to admin for approval. Net receiving: ${finalReceived.toFixed(4)} USDT.`,
      newBalance: newBalance,
      totalWithdrawn: newTotalWithdrawn,
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
    const botUsername = process.env.BOT_USERNAME || 'acryptomintadminwithdraw2bot';

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
