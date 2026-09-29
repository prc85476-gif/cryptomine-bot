const { Bot } = require('node-telegram-bot-api');
const dbService = require('./dbService');
const db = require('../config/db');

class MainBotService {
  constructor() {
    this.bot = null;
    this.isInitialized = false;
  }

  init() {
    const token = process.env.MAIN_BOT_TOKEN || '8661464093:AAHyisARtmO8ky21lvYZSttz-XXzDt56HV8';
    if (!token || token.trim() === '' || token.includes('YOUR_BOT_TOKEN')) {
      console.warn('⚠️ Main Telegram Bot Token is not set. Main user bot skipped.');
      return;
    }

    try {
      this.bot = new Bot(token.trim());
      this.registerHandlers();

      this.bot.startPolling().catch((err) => {
        console.warn('⚠️ Main Telegram bot polling stopped or failed:', err.message);
      });

      this.isInitialized = true;
      console.log('🤖 Main User Telegram Bot initialized & listening for /start...');
    } catch (err) {
      console.error('❌ Failed to initialize Main Telegram Bot:', err.message);
    }
  }

  registerHandlers() {
    if (!this.bot) return;

    // Handle /start command (with optional referral payload: /start REF-12345 or /start CRYPTO-9482)
    this.bot.command('start', async (ctx) => {
      try {
        const chatId = ctx.chatId;
        const from = ctx.from;
        const userId = from?.id;
        const username = from?.username ? `@${from.username}` : from?.first_name || 'Miner';
        const firstName = from?.first_name || 'Miner';
        const lastName = from?.last_name || '';

        if (!userId) return;

        // 1. Check if user is banned
        const isBanned = await dbService.isUserBanned(userId);
        if (isBanned) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: '🚫 <b>Your account has been suspended by the administrator.</b>\nYou are restricted from accessing this bot and the Mini App.',
            parse_mode: 'HTML'
          });
          return;
        }

        // 2. Extract referral payload if present (/start <refCode>)
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        let referrerId = null;

        if (parts.length > 1) {
          const refParam = parts[1].trim();
          try {
            // Find referrer by referral code or telegram_id
            const refQuery = await db.query(
              'SELECT telegram_id FROM users WHERE referral_code = $1 OR telegram_id = $2 LIMIT 1',
              [refParam, isNaN(refParam) ? 0 : Number(refParam)]
            );
            if (refQuery.rows.length > 0 && refQuery.rows[0].telegram_id !== userId) {
              referrerId = refQuery.rows[0].telegram_id;
            }
          } catch (e) {
            console.warn('Referral param lookup warning:', e.message);
          }
        }

        // 3. Register or get user from Neon DB
        await dbService.getUser(userId, {
          username: from?.username || `user_${userId}`,
          firstName,
          lastName,
          referrerId
        }).catch((err) => {
          console.error('Error in main bot getUser:', err.message);
        });

        // 4. Prepare Mini App WebApp URL
        const appUrl = (process.env.MINI_APP_URL || 'https://cryptomine-app.com').trim();

        // 5. Send Rich Welcome Message with "Mint NFT" Button
        const welcomeMessage = `👋 <b>Welcome ${firstName}!</b> 💎⚡

🤖 <b>CryptoMine — NFT & Cloud Mining</b>
━━━━━━━━━━━━━━━━━━━━
⛏️ <i>Mine USDT daily with next-gen AI Cyber Miners, build your hashpower, and withdraw directly to your BEP-20 wallet!</i>

✨ <b>Key Features:</b>
• 🤖 <b>AI Robot Miners:</b> Earn daily USDT rewards
• ⚡ <b>24h Mining Cycles:</b> Instant claims & auto-compound
• 👥 <b>3-Tier Referral System:</b> Earn up to 10% commission
• 💳 <b>Instant On-Chain Withdrawals:</b> Direct BEP-20 payouts

👇 <b>Click below to launch the Mini App & start mining:</b>`;

        const buttonOptions = {
          chat_id: chatId,
          text: welcomeMessage,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '💎 Mint NFT',
                  web_app: { url: appUrl }
                }
              ]
            ]
          }
        };

        await this.bot.api.sendMessage(buttonOptions);
      } catch (err) {
        console.error('Error handling /start in Main Bot:', err.message);
      }
    });

    // /help command
    this.bot.command('help', async (ctx) => {
      try {
        const appUrl = (process.env.MINI_APP_URL || 'https://cryptomine-app.com').trim();
        await this.bot.api.sendMessage({
          chat_id: ctx.chatId,
          text: `ℹ️ <b>CryptoMine Bot Help</b>\n\nClick the <b>Mint NFT</b> button below to launch the Mini App, activate miners, and manage your crypto earnings!`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '💎 Mint NFT',
                  web_app: { url: appUrl }
                }
              ]
            ]
          }
        });
      } catch (err) {
        console.error('Error handling /help in Main Bot:', err.message);
      }
    });
  }

  /**
   * Helper to send message to user with fallback to admin bot instance
   */
  async sendMessageToUser(userId, options) {
    const targetChatId = Number(userId);
    let sent = false;

    if (this.bot) {
      try {
        await this.bot.api.sendMessage({ ...options, chat_id: targetChatId });
        sent = true;
      } catch (err) {
        // Fallback to admin bot if user has chat history there
      }
    }

    if (!sent) {
      const telegramBotService = require('./telegramBotService');
      if (telegramBotService?.bot) {
        try {
          await telegramBotService.bot.api.sendMessage({ ...options, chat_id: targetChatId });
        } catch (e) {}
      }
    }
  }

  /**
   * Send 1-line Instant Pending Notification to User's Telegram
   */
  async notifyUserWithdrawalPending(userId, amount) {
    if (!userId) return;
    const msg = `✅ <b>Your withdrawal request for ${parseFloat(amount).toFixed(2)} USDT has been pending ,approve 1-2 miniuts</b>`;
    await this.sendMessageToUser(userId, {
      text: msg,
      parse_mode: 'HTML'
    });
  }

  /**
   * Send Rich Approved & Paid Notification to User's Telegram with BscScan Link & Explorer card
   */
  async notifyUserWithdrawalApproved(userId, data) {
    if (!userId) return;
    const { amount, finalReceived, fee, address, txHash, bscScanUrl } = data;
    const cleanBscScanUrl = bscScanUrl || `https://bscscan.com/tx/${txHash}`;
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    const approvedMsg = `✅ <b>Your withdrawal request for ${parseFloat(amount).toFixed(2)} USDT has been approved 💸</b>
━━━━━━━━━━━━━━━━━━━━
💰 <b>Amount Sent:</b> <code>${parseFloat(finalReceived).toFixed(4)} USDT</code> (Fee: ${parseFloat(fee || 0).toFixed(4)} USDT)
🌐 <b>Network:</b> BEP-20 (BNB Smart Chain)
📍 <b>Destination Address:</b>
<code>${address}</code>
━━━━━━━━━━━━━━━━━━━━
• 🔗 <b>TXID:</b>
<code>${txHash}</code>
• 🔍 <a href="${cleanBscScanUrl}"><b>View on BscScan</b></a>
• 🟢 <b>Status:</b> ON-CHAIN CONFIRMED
• ⏰ <b>Time:</b> ${nowUtc}
━━━━━━━━━━━━━━━━━━━━
💸 <i>Funds have been successfully transferred to your wallet!</i>`;

    await this.sendMessageToUser(userId, {
      text: approvedMsg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔍 View on BscScan', url: cleanBscScanUrl }
          ]
        ]
      }
    });
  }

  /**
   * Send Rejected & Refunded Notification to User's Telegram
   */
  async notifyUserWithdrawalRejected(userId, amount) {
    if (!userId) return;
    const msg = `❌ <b>Your withdrawal request for ${parseFloat(amount).toFixed(2)} USDT was not approved.</b>\n🔄 <i>${parseFloat(amount).toFixed(4)} USDT has been refunded back to your withdrawable balance.</i>`;
    await this.sendMessageToUser(userId, {
      text: msg,
      parse_mode: 'HTML'
    });
  }
}

module.exports = new MainBotService();
