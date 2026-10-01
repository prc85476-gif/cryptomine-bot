const { ethers } = require('ethers');
const dbService = require('./dbService');
const telegramBotService = require('./telegramBotService');
const mainBotService = require('./mainBotService');

// Verified, high-speed BSC RPC Endpoints with automatic rotation
const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed2.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
  'https://bsc-rpc.publicnode.com'
];

const USDT_BEP20_CONTRACT = (process.env.USDT_BEP20_CONTRACT || '0x55d398326f99059fF775485246999027B3197955').toLowerCase();
const DEFAULT_DEPOSIT_ADDRESS = (process.env.DEPOSIT_WALLET_ADDRESS || '0x91AbcbAbE89945De4e491bf8850Bae836dB66547').toLowerCase();

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

class DepositWatcherService {
  constructor() {
    this.provider = null;
    this.currentRpcIndex = 0;
    this.depositAddress = DEFAULT_DEPOSIT_ADDRESS;
    this.activeIntents = new Map(); // in-memory cache: exactAmountStr -> intent
    this.userIntents = new Map();   // in-memory cache: userId -> intent
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
   * Formatted with double zeros: e.g. 1.0042 or 5.0042 (base.00 + 2-3 digits of TG UID)
   */
  calculateExactAmount(baseAmount, userId, telegramId) {
    const numAmt = parseFloat(baseAmount) || 1.0;
    const baseInt = Math.floor(numAmt);
    const idStr = String(telegramId || userId || '789').replace(/\D/g, '') || '42';
    let uidDigits = idStr.slice(-2);
    if (uidDigits === '00' || uidDigits.length < 2) {
      uidDigits = idStr.slice(-3);
      if (uidDigits === '000' || uidDigits.length < 2) {
        uidDigits = '24';
      }
    }
    
    let exact = `${baseInt}.00${uidDigits}`;
    let counter = 1;
    while (this.activeIntents.has(exact) && this.activeIntents.get(exact).userId !== String(userId)) {
      const nextSuffix = (parseInt(uidDigits, 10) + counter).toString().padStart(2, '0');
      exact = `${baseInt}.00${nextSuffix}`;
      counter++;
    }
    return exact;
  }

  /**
   * Register a new deposit intent and persist to Neon Database
   */
  async registerIntent({ userId, telegramId, username, baseAmount, network }) {
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
      expiresAt: Date.now() + 4 * 60 * 60 * 1000 // 4 hours
    };

    // Cache in RAM
    this.activeIntents.set(exactAmount, intent);
    this.userIntents.set(String(userId), intent);

    // Persist in PostgreSQL Database
    try {
      const dbRecord = await dbService.saveDepositIntent(intent);
      if (dbRecord) intent.dbId = dbRecord.id;
    } catch (err) {
      console.warn('Could not persist deposit intent to DB:', err.message);
    }

    console.log(`📥 Registered Deposit Intent: User ${userId} (@${intent.username}) | Base: ${intent.baseAmount} USDT -> Exact: ${intent.exactAmount} USDT`);
    return intent;
  }

  /**
   * Get active intent for a user (from RAM or DB fallback)
   */
  async getUserIntent(userId) {
    let intent = this.userIntents.get(String(userId));
    if (intent && Date.now() <= intent.expiresAt) {
      return intent;
    }

    // Fallback: check PostgreSQL database
    try {
      const dbIntent = await dbService.getWaitingDepositIntent(userId);
      if (dbIntent) {
        intent = {
          dbId: dbIntent.id,
          userId: String(dbIntent.user_id),
          telegramId: Number(dbIntent.telegram_id || dbIntent.user_id),
          username: dbIntent.username || 'Miner',
          baseAmount: parseFloat(dbIntent.base_amount),
          exactAmount: parseFloat(dbIntent.exact_amount).toFixed(4),
          network: dbIntent.network || 'USDT BEP20',
          depositAddress: dbIntent.deposit_address,
          status: dbIntent.status,
          createdAt: new Date(dbIntent.created_at).getTime(),
          expiresAt: new Date(dbIntent.expires_at).getTime()
        };
        this.userIntents.set(String(userId), intent);
        this.activeIntents.set(intent.exactAmount, intent);
        return intent;
      }
    } catch (e) {}

    return null;
  }

  /**
   * Check status of deposit for user (includes on-demand quick scan)
   */
  async checkStatus(userId) {
    const intent = await this.getUserIntent(userId);

    // If no waiting intent, check if there was a recently confirmed transaction in DB
    if (!intent) {
      try {
        const txs = await dbService.getTransactions(userId, 3);
        const recentDeposit = (txs || []).find(t => String(t.type || '').includes('Deposit') && t.status === 'Completed');
        if (recentDeposit) {
          const user = await dbService.getUser(userId);
          return {
            hasActiveIntent: true,
            confirmed: true,
            status: 'Confirmed',
            baseAmount: parseFloat(String(recentDeposit.amount).replace(/[^0-9.]/g, '')),
            newBalance: user ? user.balance : 0,
            depositBalance: user ? user.depositBalance : 0,
            txHash: recentDeposit.txHash
          };
        }
      } catch (e) {}
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
    await this.scanRecentTransfers(50).catch(() => {});

    // Re-check intent status after scan
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
   * Scan recent BSC blocks for incoming BEP-20 USDT transfers to depositAddress
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
        this.switchRpc();
        events = await usdtContract.queryFilter(filter, Math.max(fromBlock, toBlock - 20), toBlock).catch(() => []);
      }

      for (const ev of events) {
        const txHash = ev.transactionHash;
        if (!txHash) continue;
        if (this.processedTxHashes.has(txHash)) continue;

        // Check if already processed in database
        const isDbProcessed = await dbService.isDepositTxProcessed(txHash);
        if (isDbProcessed) {
          this.processedTxHashes.add(txHash);
          continue;
        }

        const rawValue = ethers.formatUnits(ev.args.value, 18);
        const valueNum = parseFloat(rawValue);
        if (isNaN(valueNum) || valueNum < 0.5) continue; // Minimum valid transfer is 0.5 USDT

        const senderAddress = ev.args.from ? String(ev.args.from).toLowerCase() : null;
        const valueFormatted = valueNum.toFixed(4);

        // Smart Multi-Level Matching:
        // 1. Check in-memory exactAmount
        let matchingIntent = this.activeIntents.get(valueFormatted) ||
                             this.activeIntents.get(valueNum.toFixed(5)) ||
                             this.activeIntents.get(String(valueNum));

        // 2. Check in-memory flexible / baseAmount match (e.g. user sent 5.00 instead of 5.0042)
        if (!matchingIntent) {
          for (const [, intent] of this.activeIntents.entries()) {
            if (intent.status === 'Waiting') {
              const intentExactNum = parseFloat(intent.exactAmount);
              const intentBaseNum = parseFloat(intent.baseAmount);
              if (
                Math.abs(valueNum - intentExactNum) <= 0.05 ||
                Math.abs(valueNum - intentBaseNum) <= 0.05
              ) {
                matchingIntent = intent;
                break;
              }
            }
          }
        }

        // 3. Check persistent database deposit_intents
        if (!matchingIntent) {
          const dbIntent = await dbService.findMatchingDepositIntent(valueNum);
          if (dbIntent) {
            matchingIntent = {
              dbId: dbIntent.id,
              userId: String(dbIntent.user_id),
              telegramId: Number(dbIntent.telegram_id || dbIntent.user_id),
              username: dbIntent.username || 'Miner',
              baseAmount: parseFloat(dbIntent.base_amount),
              exactAmount: parseFloat(dbIntent.exact_amount).toFixed(4),
              network: dbIntent.network || 'USDT BEP20',
              depositAddress: dbIntent.deposit_address,
              status: dbIntent.status
            };
          }
        }

        // 4. If an intent is matched, credit the deposit!
        if (matchingIntent && matchingIntent.status === 'Waiting') {
          console.log(`🔥 [DepositWatcher] MATCHED ON-CHAIN DEPOSIT! Tx: ${txHash} | Amount: ${valueNum} USDT | User: ${matchingIntent.userId}`);
          this.processedTxHashes.add(txHash);

          const result = await this.creditDeposit({
            intent: matchingIntent,
            txHash: txHash,
            transferredAmount: valueNum,
            senderAddress: senderAddress,
            blockNumber: ev.blockNumber
          });
          confirmedList.push(result);
        }
      }

      this.lastScannedBlock = toBlock;
    } catch (err) {
      console.warn('Deposit scan iteration notice:', err.message);
      this.switchRpc();
    } finally {
      this.isScanning = false;
    }

    return confirmedList;
  }

  /**
   * Verify and credit on-chain deposit by explicit Transaction Hash (TXID)
   */
  async verifyTxHash(userId, txHash) {
    if (!txHash || typeof txHash !== 'string') {
      return { success: false, message: 'Invalid Transaction Hash format' };
    }

    const cleanHash = txHash.trim();
    if (!cleanHash.startsWith('0x') || cleanHash.length !== 66) {
      return { success: false, message: 'Invalid BSC transaction hash! TXID must start with 0x and be 66 characters long.' };
    }

    // 1. Check if already processed
    const alreadyProcessed = await dbService.isDepositTxProcessed(cleanHash);
    if (alreadyProcessed) {
      return { success: false, message: 'This transaction has already been credited to an account!' };
    }

    try {
      if (!this.provider) this.initProvider();

      // Fetch transaction receipt from BSC
      let receipt = null;
      try {
        receipt = await this.provider.getTransactionReceipt(cleanHash);
      } catch (e) {
        this.switchRpc();
        receipt = await this.provider.getTransactionReceipt(cleanHash);
      }

      if (!receipt) {
        return {
          success: false,
          message: 'Transaction not found on BSC yet. It may still be pending in the mempool. Please wait 15 seconds and try again.'
        };
      }

      if (receipt.status !== 1) {
        return { success: false, message: 'This blockchain transaction failed or was reverted on BSC!' };
      }

      // Parse ERC-20 Transfer logs
      const iface = new ethers.Interface(ERC20_TRANSFER_ABI);
      let usdtTransferred = 0;
      let senderAddr = null;
      let matchedTransfer = false;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === USDT_BEP20_CONTRACT) {
          try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'Transfer') {
              const toAddr = String(parsed.args.to).toLowerCase();
              if (toAddr === this.depositAddress) {
                matchedTransfer = true;
                senderAddr = String(parsed.args.from).toLowerCase();
                usdtTransferred = parseFloat(ethers.formatUnits(parsed.args.value, 18));
                break;
              }
            }
          } catch (e) {}
        }
      }

      if (!matchedTransfer || usdtTransferred <= 0) {
        return {
          success: false,
          message: `No USDT transfer to the deposit wallet (${this.depositAddress.substring(0, 8)}...) was found in this transaction!`
        };
      }

      if (usdtTransferred < 0.5) {
        return {
          success: false,
          message: `Minimum deposit amount is 1 USDT. Transferred amount was ${usdtTransferred} USDT.`
        };
      }

      // Check active intent for this user
      let intent = await this.getUserIntent(userId);
      if (!intent) {
        const user = await dbService.getUser(userId);
        intent = {
          userId: String(userId),
          telegramId: user ? Number(user.telegramId) : Number(userId),
          username: user ? (user.username || user.name || 'Miner') : 'Miner',
          baseAmount: usdtTransferred,
          exactAmount: usdtTransferred.toFixed(4),
          network: 'USDT BEP20',
          depositAddress: this.depositAddress,
          status: 'Waiting'
        };
      }

      // Credit the verified deposit
      const result = await this.creditDeposit({
        intent: intent,
        txHash: cleanHash,
        transferredAmount: usdtTransferred,
        senderAddress: senderAddr,
        blockNumber: receipt.blockNumber
      });

      return result;
    } catch (err) {
      console.error('verifyTxHash error:', err);
      return { success: false, message: `Verification error: ${err.message}` };
    }
  }

  /**
   * Credit user deposit balance in Database, record ledger, distribute commissions and notify
   */
  async creditDeposit({ intent, txHash, transferredAmount, senderAddress, blockNumber }) {
    try {
      const cleanTxHash = txHash.trim().toLowerCase();
      const creditAmt = parseFloat(transferredAmount) || parseFloat(intent.baseAmount);

      intent.status = 'Confirmed';
      intent.txHash = cleanTxHash;
      intent.confirmedAt = Date.now();

      // 1. Record into processed_deposits ledger
      await dbService.recordProcessedDeposit({
        txHash: cleanTxHash,
        userId: intent.userId,
        amount: creditAmt,
        senderAddress: senderAddress,
        receiverAddress: this.depositAddress,
        network: intent.network || 'USDT BEP20',
        blockNumber: blockNumber
      });

      // 2. Mark deposit_intents in DB as Confirmed
      if (intent.dbId) {
        await dbService.markDepositIntentConfirmed(intent.dbId, cleanTxHash);
      }

      // 3. Atomically update user balance in Neon database
      const user = await dbService.getUser(intent.userId);
      const currentDepBal = user ? (user.depositBalance || 0) : 0;
      const currentTotalDep = user ? (user.totalDeposited || 0) : 0;
      const newDepositBal = parseFloat((currentDepBal + creditAmt).toFixed(4));
      const newTotalDeposited = parseFloat((currentTotalDep + creditAmt).toFixed(4));

      await dbService.updateUser(intent.userId, {
        depositBalance: newDepositBal,
        totalDeposited: newTotalDeposited
      });

      // 4. Add transaction record to ledger
      const shortHash = `${cleanTxHash.substring(0, 6)}...${cleanTxHash.substring(cleanTxHash.length - 4)}`;
      const txId = `tx-dep-${Date.now()}`;
      await dbService.addTransaction({
        id: txId,
        userId: intent.userId,
        type: `Deposit NFT Fund (${intent.network || 'USDT BEP20'}) - ${shortHash}`,
        amount: `+${creditAmt.toFixed(4)} USDT`,
        txHash: cleanTxHash,
        network: intent.network || 'USDT BEP20',
        status: 'Completed',
        positive: true,
        date: 'Just now'
      });

      // 5. Distribute 3-tier referral commissions on deposit
      dbService.distributeReferralCommission(intent.userId, creditAmt, 'Deposit').catch((e) => {
        console.warn('Referral commission error on deposit:', e.message);
      });

      // 6. Dispatch Rich Telegram Alert to Admin Bot
      const refData = await dbService.getReferrals(intent.userId);
      telegramBotService.notifyDepositAlert({
        userId: intent.telegramId,
        username: intent.username,
        name: user?.name || user?.firstName || 'Miner',
        amount: creditAmt,
        network: intent.network || 'USDT BEP20',
        txHash: cleanTxHash,
        depositBalance: newDepositBal,
        mainBalance: user ? user.balance : 0,
        totalDeposited: newTotalDeposited,
        totalReferrals: refData?.invitedCount || 0
      }).catch((e) => console.warn('Admin deposit alert error:', e.message));

      // 7. Send Rich Instant Confirmation to User's Telegram Bot
      if (mainBotService) {
        const cleanBscUrl = `https://bscscan.com/tx/${cleanTxHash}`;
        const userMsg = `🎉 <b>Deposit Confirmed &amp; Added!</b> 💰
━━━━━━━━━━━━━━━━━━━━
💰 <b>Amount Credited:</b> <code>+${creditAmt.toFixed(2)} USDT</code>
🌐 <b>Network:</b> <code>${intent.network || 'USDT BEP20'}</code>
🔗 <b>TXID:</b> <a href="${cleanBscUrl}">View on BscScan</a>
🟢 <b>Status:</b> ON-CHAIN CONFIRMED &amp; CREDITED
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
        }).catch(() => {});
      }

      // Cleanup intent from cache after 10s
      setTimeout(() => {
        this.activeIntents.delete(intent.exactAmount);
        this.userIntents.delete(String(intent.userId));
      }, 10000);

      return {
        success: true,
        confirmed: true,
        userId: intent.userId,
        baseAmount: creditAmt,
        newBalance: user ? user.balance : 0,
        depositBalance: newDepositBal,
        txHash: cleanTxHash
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
      this.scanRecentTransfers(70).catch(() => {});
    }, 4000); // Check every 4 seconds
  }
}

module.exports = new DepositWatcherService();
