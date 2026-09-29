const { ethers } = require('ethers');
const dbService = require('./dbService');
const telegramBotService = require('./telegramBotService');
const mainBotService = require('./mainBotService');

// BSC RPC Endpoints with automatic fallback (tested for eth_getLogs reliability)
const BSC_RPCS = [
  'https://bsc-rpc.publicnode.com',
  'https://1rpc.io/bnb',
  'https://bsc.drpc.org',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/'
];

const USDT_BEP20_CONTRACT = process.env.USDT_BEP20_CONTRACT || '0x55d398326f99059fF775485246999027B3197955';
const DEFAULT_DEPOSIT_ADDRESS = process.env.DEPOSIT_WALLET_ADDRESS || '0x91AbcbAbE89945De4e491bf8850Bae836dB66547';

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

class DepositWatcherService {
  constructor() {
    this.provider = null;
    this.currentRpcIndex = 0;
    this.depositAddress = DEFAULT_DEPOSIT_ADDRESS.toLowerCase();
    this.activeIntents = new Map(); // exactAmountStr -> intent
    this.userIntents = new Map();   // userId -> intent
    this.processedTxHashes = new Set();
    this.lastScannedBlock = 0;
    this.isScanning = false;
    this.initProvider();
    this.startBackgroundWatcher();
  }

  initProvider() {
    try {
      const rpcUrl = BSC_RPCS[this.currentRpcIndex];
      const bscNetwork = ethers.Network.from(56);
      this.provider = new ethers.JsonRpcProvider(rpcUrl, bscNetwork, { staticNetwork: bscNetwork });
    } catch (err) {
      console.error('DepositWatcher provider init error:', err.message);
    }
  }

  switchRpc() {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % BSC_RPCS.length;
    this.initProvider();
  }

  /**
   * Calculate deterministic unique decimal amount for a user based on Telegram ID or User ID
   * Formatted with double zeros: e.g. 1.0042 or 3.0042 (base.00 + 2-3 digits of TG UID)
   */
  calculateExactAmount(baseAmount, userId, telegramId) {
    const numAmt = parseFloat(baseAmount) || 1.0;
    const baseInt = Math.floor(numAmt);
    const idStr = String(telegramId || userId || '789').replace(/\D/g, '') || '42';
    // Extract last 2 or 3 digits of Telegram UID (e.g. '42' or '942')
    let uidDigits = idStr.slice(-2);
    if (uidDigits === '00' || uidDigits.length < 2) {
      uidDigits = idStr.slice(-3);
      if (uidDigits === '000' || uidDigits.length < 2) {
        uidDigits = '24';
      }
    }
    
    // Format as base.00 + uidDigits -> e.g. 1.0042 or 3.0042
    let exact = `${baseInt}.00${uidDigits}`;
    
    // Handle collision if another active intent exists with same exact amount
    let counter = 1;
    while (this.activeIntents.has(exact) && this.activeIntents.get(exact).userId !== String(userId)) {
      const nextSuffix = (parseInt(uidDigits, 10) + counter).toString().padStart(2, '0');
      exact = `${baseInt}.00${nextSuffix}`;
      counter++;
    }
    return exact;
  }

  /**
   * Register a new deposit intent
   */
  registerIntent({ userId, telegramId, username, baseAmount, network }) {
    // If user already has an active intent, clean up old amount mapping
    const existing = this.userIntents.get(String(userId));
    if (existing && existing.exactAmount) {
      this.activeIntents.delete(existing.exactAmount);
    }

    const exactAmount = this.calculateExactAmount(baseAmount, userId, telegramId);
    const intent = {
      userId: String(userId),
      telegramId: telegramId ? Number(telegramId) : Number(userId),
      username: username || 'Miner',
      baseAmount: parseFloat(baseAmount),
      exactAmount: exactAmount,
      network: network || 'USDT BEP20',
      depositAddress: this.depositAddress,
      status: 'Waiting',
      createdAt: Date.now(),
      expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
    };

    this.activeIntents.set(exactAmount, intent);
    this.userIntents.set(String(userId), intent);

    console.log(`📥 Registered Deposit Intent: User ${userId} (${intent.username}) | Base: ${intent.baseAmount} USDT -> Exact: ${intent.exactAmount} USDT`);
    return intent;
  }

  /**
   * Get active intent for a user
   */
  getUserIntent(userId) {
    const intent = this.userIntents.get(String(userId));
    if (intent && Date.now() > intent.expiresAt) {
      this.activeIntents.delete(intent.exactAmount);
      this.userIntents.delete(String(userId));
      return null;
    }
    return intent;
  }

  /**
   * Check status of deposit for user (includes on-demand quick scan)
   */
  async checkStatus(userId) {
    const intent = this.getUserIntent(userId);
    if (!intent) {
      return { hasActiveIntent: false };
    }

    if (intent.status === 'Confirmed') {
      const user = await dbService.getUser(userId);
      return {
        hasActiveIntent: true,
        confirmed: true,
        status: 'Confirmed',
        exactAmount: intent.exactAmount,
        baseAmount: intent.baseAmount,
        newBalance: user ? user.balance : 0,
        depositBalance: user ? user.depositBalance : 0,
        txHash: intent.txHash
      };
    }

    // Trigger an active quick scan of recent blocks on-demand
    await this.scanRecentTransfers(40).catch(() => {});

    if (intent.status === 'Confirmed') {
      const user = await dbService.getUser(userId);
      return {
        hasActiveIntent: true,
        confirmed: true,
        status: 'Confirmed',
        exactAmount: intent.exactAmount,
        baseAmount: intent.baseAmount,
        newBalance: user ? user.balance : 0,
        depositBalance: user ? user.depositBalance : 0,
        txHash: intent.txHash
      };
    }

    return {
      hasActiveIntent: true,
      confirmed: false,
      status: intent.status,
      exactAmount: intent.exactAmount,
      baseAmount: intent.baseAmount,
      network: intent.network,
      depositAddress: intent.depositAddress,
      expiresAt: intent.expiresAt
    };
  }

  /**
   * Scan recent BSC blocks for incoming USDT transfers matching deposit intents
   */
  async scanRecentTransfers(blockRange = 60) {
    if (this.isScanning) return [];
    this.isScanning = true;
    const confirmedList = [];

    try {
      if (!this.provider) this.initProvider();
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = this.lastScannedBlock > 0 
        ? Math.max(this.lastScannedBlock - 5, currentBlock - blockRange)
        : currentBlock - blockRange;
      const toBlock = currentBlock;

      if (fromBlock > toBlock) {
        this.isScanning = false;
        return [];
      }

      // 1. Scan BEP-20 USDT Transfers
      const usdtContract = new ethers.Contract(USDT_BEP20_CONTRACT, ERC20_TRANSFER_ABI, this.provider);
      const filter = usdtContract.filters.Transfer(null, this.depositAddress);
      
      let events = [];
      try {
        events = await usdtContract.queryFilter(filter, fromBlock, toBlock);
      } catch (logErr) {
        // Fallback RPC if rate limited
        this.switchRpc();
        events = await usdtContract.queryFilter(filter, Math.max(fromBlock, toBlock - 25), toBlock).catch(() => []);
      }

      for (const ev of events) {
        const txHash = ev.transactionHash;
        if (this.processedTxHashes.has(txHash)) continue;

        const rawValue = ethers.formatUnits(ev.args.value, 18);
        const valueNum = parseFloat(rawValue);
        const valueFormatted = valueNum.toFixed(4);
        const valueFormatted5 = valueNum.toFixed(5);
        const valueRawStr = String(valueNum);
        
        // 1. Direct match by exactAmount string (4 or 5 decimals or raw float string)
        let matchingIntent = this.activeIntents.get(valueFormatted) || 
                             this.activeIntents.get(valueFormatted5) || 
                             this.activeIntents.get(valueRawStr);

        // 2. Fallback: Flexible match if user sent exactAmount with slight float variance or baseAmount
        if (!matchingIntent) {
          for (const [, intent] of this.activeIntents.entries()) {
            if (intent.status === 'Waiting') {
              const intentExactNum = parseFloat(intent.exactAmount);
              const intentBaseNum = parseFloat(intent.baseAmount);
              if (Math.abs(valueNum - intentExactNum) <= 0.0002 || Math.abs(valueNum - intentBaseNum) <= 0.0002) {
                matchingIntent = intent;
                break;
              }
            }
          }
        }

        if (matchingIntent && matchingIntent.status === 'Waiting') {
          console.log(`🔥 MATCHED ON-CHAIN DEPOSIT! Tx: ${txHash} | Amount: ${valueFormatted} USDT | User: ${matchingIntent.userId}`);
          this.processedTxHashes.add(txHash);

          const result = await this.creditDeposit(matchingIntent, txHash, valueFormatted);
          confirmedList.push(result);
        }
      }

      this.lastScannedBlock = toBlock;
    } catch (err) {
      console.warn('Deposit scan iteration error:', err.message);
      this.switchRpc();
    } finally {
      this.isScanning = false;
    }

    return confirmedList;
  }

  /**
   * Credit user balance in DB and dispatch notifications
   */
  async creditDeposit(intent, txHash, transferredAmount) {
    try {
      intent.status = 'Confirmed';
      intent.txHash = txHash;
      intent.confirmedAt = Date.now();

      const user = await dbService.getUser(intent.userId);
      const creditAmt = intent.baseAmount;
      const currentDepBal = user ? (user.depositBalance || 0) : 0;
      const currentTotalDep = user ? (user.totalDeposited || 0) : 0;
      const newDepositBal = parseFloat((currentDepBal + creditAmt).toFixed(4));
      const newTotalDeposited = parseFloat((currentTotalDep + creditAmt).toFixed(4));

      // 1. Update user in Neon database
      await dbService.updateUser(intent.userId, {
        depositBalance: newDepositBal,
        totalDeposited: newTotalDeposited
      });

      // 2. Add transaction record
      const shortHash = `${txHash.substring(0, 6)}...${txHash.substring(txHash.length - 4)}`;
      const txId = `tx-dep-${Date.now()}`;
      await dbService.addTransaction({
        id: txId,
        userId: intent.userId,
        type: `Deposit NFT Fund (${intent.network}) - ${shortHash}`,
        amount: `+${creditAmt.toFixed(4)} USDT`,
        txHash: txHash,
        network: intent.network,
        status: 'Completed',
        positive: true,
        date: 'Just now'
      });

      // Distribute 3-tier referral commissions on deposit
      dbService.distributeReferralCommission(intent.userId, creditAmt, 'Deposit').catch((e) => {
        console.warn('Referral commission error on deposit:', e.message);
      });

      // 3. Dispatch Rich Telegram Alert to Admin Bot
      const refData = await dbService.getReferrals(intent.userId);
      telegramBotService.notifyDepositAlert({
        userId: intent.telegramId,
        username: intent.username,
        name: user?.name || user?.firstName || 'Miner',
        amount: creditAmt,
        network: intent.network,
        txHash: txHash,
        depositBalance: newDepositBal,
        mainBalance: user ? user.balance : 0,
        totalDeposited: newTotalDeposited,
        totalReferrals: refData?.invitedCount || 0
      }).catch((e) => console.warn('Admin deposit alert error:', e.message));

      // 4. Send Rich Instant Confirmation to User's Telegram Bot
      if (mainBotService) {
        const cleanBscUrl = `https://bscscan.com/tx/${txHash}`;
        const userMsg = `🎉 <b>Deposit Confirmed &amp; Added!</b> 💰
━━━━━━━━━━━━━━━━━━━━
💰 <b>Amount Credited:</b> <code>+${creditAmt.toFixed(2)} USDT</code>
🌐 <b>Network:</b> <code>${intent.network}</code>
🔗 <b>TXID:</b> <a href="${cleanBscUrl}">View on BscScan</a>
🟢 <b>Status:</b> ON-CHAIN CONFIRMED
━━━━━━━━━━━━━━━━━━━━
💎 <i>Funds are now in your NFT Purchase Balance. Open the Mini App to start mining or minting NFTs!</i>`;

        mainBotService.sendMessageToUser(intent.telegramId, {
          text: userMsg,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 View on BscScan', url: cleanBscUrl }]
            ]
          }
        }).catch((e) => {});
      }

      // Cleanup intent after successful confirmation
      setTimeout(() => {
        this.activeIntents.delete(intent.exactAmount);
      }, 5000);

      return {
        success: true,
        confirmed: true,
        userId: intent.userId,
        baseAmount: creditAmt,
        newBalance: user ? user.balance : 0,
        depositBalance: newDepositBal,
        txHash: txHash
      };
    } catch (err) {
      console.error('creditDeposit error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Start standing background polling for blockchain deposits
   */
  startBackgroundWatcher() {
    setInterval(() => {
      if (this.activeIntents.size > 0) {
        this.scanRecentTransfers(80).catch(() => {});
      }
    }, 5000); // Check every 5 seconds
  }
}

module.exports = new DepositWatcherService();
