const fs = require('fs');
const path = require('path');
const { Bot, InputFile } = require('node-telegram-bot-api');
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

      this.bot.catch((err) => {
        console.error('⚠️ [Main Bot] Internal update handler error:', err.message || err);
      });

      this.registerHandlers();
      this.startPollingLoop();

      this.isInitialized = true;
      console.log('🤖 Main User Telegram Bot initialized & listening for /start...');
    } catch (err) {
      console.error('❌ Failed to initialize Main Telegram Bot:', err.message);
    }
  }

  async startPollingLoop() {
    if (this.isPollingActive) return;
    this.isPollingActive = true;

    while (this.isPollingActive) {
      try {
        await this.bot.startPolling(undefined, {
          dropPendingUpdates: false,
          allowedUpdates: ['message', 'callback_query']
        });
      } catch (err) {
        console.warn('⚠️ [Main Bot] Polling connection notice:', err.message || err, '— Reconnecting in 3s...');
      }
      await new Promise(r => setTimeout(r, 3000));
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
            text: `🚫 <b>MULTIPLE ID / ACCOUNT BANNED!</b>\n━━━━━━━━━━━━━━━━━━━━\n⚠️ <i>Multiple accounts from the same device / IP address are strictly prohibited.</i>\n\n🔒 Your account has been suspended for violating our single-account policy.\n\n📞 <b>Contact Support:</b> @CryptoMint_Support_bot`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Contact Support', url: 'https://t.me/CryptoMint_Support_bot' }]
              ]
            }
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
            referrerId = await dbService.findReferrerIdByCode(refParam);
            if (referrerId && Number(referrerId) === Number(userId)) {
              referrerId = null; // Cannot refer oneself
            }
          } catch (e) {
            console.warn('Referral param lookup warning:', e.message);
          }
        }

        // 3. Register or get user from Neon DB
        const user = await dbService.getUser(userId, {
          username: from?.username || `user_${userId}`,
          firstName,
          lastName,
          referrerId,
          startParam: parts.length > 1 ? parts[1].trim() : null
        }).catch((err) => {
          console.error('Error in main bot getUser:', err.message);
          return null;
        });

        if (user && user.isBanned) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `🚫 <b>MULTIPLE ID / ACCOUNT BANNED!</b>\n━━━━━━━━━━━━━━━━━━━━\n⚠️ <i>Multiple accounts from the same device / IP address are strictly prohibited.</i>\n\n🔒 Your account has been suspended for violating our single-account policy.\n\n📞 <b>Contact Support:</b> @CryptoMint_Support_bot`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Contact Support', url: 'https://t.me/CryptoMint_Support_bot' }]
              ]
            }
          });
          return;
        }

        // 4. Prepare Mini App WebApp URL
        const appUrl = (process.env.MINI_APP_URL || 'https://cryptomine-app.com').trim();

        // 5. Rich Welcome Message Caption
        const welcomeMessage = `👋 <b>Welcome ${firstName}!</b> 💎⚡

🤖 <b>CryptoMine — NFT & Cloud Mining</b>
━━━━━━━━━━━━━━━━━━━━
⛏️ <i>Mine USDT daily with next-gen AI Cyber Miners, build your hashpower, and withdraw directly to your BEP-20 wallet!</i>

✨ <b>Key Features:</b>
• 🎁 <b>Free Starter Miner:</b> Free 0.02 USDT Daily for 20 Days!
• 🤖 <b>AI Robot Miners:</b> Upgrade hashpower for higher returns
• ⚡ <b>24h Mining Cycles:</b> Instant claims & auto-compound
• 👥 <b>3-Tier Referral System:</b> Earn up to 10% commission
• 💳 <b>Instant On-Chain Withdrawals:</b> Direct BEP-20 payouts

👇 <b>Click below to launch the Mini App & start mining:</b>`;

        const replyMarkup = {
          inline_keyboard: [
            [
              {
                text: '💎 Mint NFT',
                web_app: { url: appUrl }
              }
            ]
          ]
        };

        // 6. Send Video with Caption and "Mint NFT" WebApp Button
        let videoSent = false;
        const videoCandidates = [
          path.join(process.cwd(), 'public/assets/videos/welcome.mp4'),
          path.join(__dirname, '../../public/assets/videos/welcome.mp4'),
          path.join(process.cwd(), 'icon logo/gemini_generated_video_22e01621.mp4'),
          path.join(__dirname, '../../icon logo/gemini_generated_video_22e01621.mp4')
        ];

        let validVideoPath = null;
        for (const candidate of videoCandidates) {
          if (fs.existsSync(candidate)) {
            validVideoPath = candidate;
            break;
          }
        }

        if (validVideoPath && InputFile) {
          try {
            await this.bot.api.sendVideo({
              chat_id: chatId,
              video: new InputFile(validVideoPath),
              caption: welcomeMessage,
              parse_mode: 'HTML',
              reply_markup: replyMarkup
            });
            videoSent = true;
          } catch (videoErr) {
            console.warn('sendVideo error in /start, trying fallback:', videoErr.message);
          }
        }

        // If local video upload was not completed, try sending via static URL
        if (!videoSent && appUrl && appUrl.startsWith('https://')) {
          try {
            const videoUrl = `${appUrl.replace(/\/+$/, '')}/assets/videos/welcome.mp4`;
            await this.bot.api.sendVideo({
              chat_id: chatId,
              video: videoUrl,
              caption: welcomeMessage,
              parse_mode: 'HTML',
              reply_markup: replyMarkup
            });
            videoSent = true;
          } catch (urlErr) {
            console.warn('sendVideo via static URL error:', urlErr.message);
          }
        }

        // Fallback to text message if video delivery fails
        if (!videoSent) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: welcomeMessage,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        }
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
    const formattedAmt = parseFloat(amount || 0).toFixed(2);
    const msg = `✅ <b>Withdrawal request for ${formattedAmt} USDT is pending. Please wait 1–2 minutes for approval.</b> 💸`;
    await this.sendMessageToUser(userId, {
      text: msg,
      parse_mode: 'HTML'
    });
  }

  /**
   * Send Approved & Paid Notification to User's Telegram
   */
  async notifyUserWithdrawalApproved(userId, data) {
    if (!userId) return;
    const { amount, finalReceived, fee, address, txHash, bscScanUrl } = data;
    const cleanBscScanUrl = bscScanUrl || `https://bscscan.com/tx/${txHash}`;
    const formattedAmount = parseFloat(finalReceived || amount || 0).toFixed(4);
    const formattedFee = parseFloat(fee || 0).toFixed(4);

    const approvedMsg = `✅ <b>Withdrawal Approved!</b> 💸
💰 <b>${formattedAmount} USDT</b> sent
🌐 <b>BEP-20</b> | Fee: ${formattedFee} USDT
🟢 <b>Status:</b> Confirmed
🔗 <b>TXID:</b> ${cleanBscScanUrl}
💸 <i>Funds sent successfully!</i>`;

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

  /**
   * Send 4-Digit Security Code with Generated Protection Card to User's Telegram
   */
  async sendWithdrawalSecurityCode(userId, data) {
    if (!userId) return;
    const { code, amount, network, address } = data;
    const { generateSecurityCard } = require('./securityCardService');
    const { InputFile } = require('node-telegram-bot-api');

    const shortAddr = address ? `${address.substring(0, 8)}...${address.substring(address.length - 6)}` : '0x...';
    const supportUrl = process.env.SUPPORT_URL || 'https://t.me/CryptoMineOfficial';
    const appUrl = (process.env.MINI_APP_URL || 'https://cryptomine-app.com').trim();

    const caption = `🔐 <b>Withdrawal Security Verification Code</b>
━━━━━━━━━━━━━━━━━━━━
💰 <b>Amount:</b> <code>${parseFloat(amount || 0).toFixed(4)} USDT</code>
🌐 <b>Network:</b> <code>${network || 'BEP-20'}</code>
📍 <b>Destination:</b> <code>${shortAddr}</code>
━━━━━━━━━━━━━━━━━━━━
🔢 <b>Your 4-Digit Security Code:</b>
👉 <code>${code}</code> 👈

🛡️ <b>Your fund is 100% protected!</b>
<i>Enter this 4-digit code in the Mini App to proceed with your withdrawal. Valid for 10 minutes.</i>`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🎧 Support', url: supportUrl },
          { text: '💎 Open Mini App', web_app: { url: appUrl } }
        ]
      ]
    };

    try {
      const cardBuffer = generateSecurityCard({
        code,
        amount: parseFloat(amount || 0).toFixed(4),
        network: network || 'BEP-20',
        address
      });

      const photoFile = new InputFile(cardBuffer, 'security-pin.png');
      const targetChatId = Number(userId);

      let sent = false;
      if (this.bot) {
        try {
          await this.bot.api.sendPhoto({
            chat_id: targetChatId,
            photo: photoFile,
            caption: caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
          sent = true;
        } catch (botErr) {
          console.warn('Main bot sendPhoto failed:', botErr.message);
        }
      }

      if (!sent) {
        const telegramBotService = require('./telegramBotService');
        if (telegramBotService?.bot) {
          try {
            await telegramBotService.bot.api.sendPhoto({
              chat_id: targetChatId,
              photo: photoFile,
              caption: caption,
              parse_mode: 'HTML',
              reply_markup: replyMarkup
            });
            sent = true;
          } catch (e) {
            console.warn('Admin bot fallback sendPhoto failed:', e.message);
          }
        }
      }

      // Fallback to text message if photo delivery fails
      if (!sent) {
        await this.sendMessageToUser(userId, {
          text: caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      }
    } catch (err) {
      console.error('sendWithdrawalSecurityCode error:', err.message);
      await this.sendMessageToUser(userId, {
        text: caption,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }
  }

  /**
   * Send notification to referrer when a new user joins with their link
   */
  async notifyReferrerNewUser(referrerId, newUsername, newFirstName) {
    if (!referrerId) return;
    try {
      const msg = `🎉 <b>New Referral Joined!</b> 👥`;
      await this.sendMessageToUser(referrerId, {
        text: msg,
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.warn('notifyReferrerNewUser warning:', err.message);
    }
  }

  /**
   * Send notification to referrer when commission is earned
   */
  async notifyReferrerCommission(referrerId, amount, tier, sourceAction) {
    if (!referrerId) return;
    try {
      const amtStr = (amount && Number(amount) > 0) ? `${parseFloat(amount).toFixed(2)}$` : '0.02$';
      const msg = `🎉  <b>Referral comition ${amtStr}!</b> 👥`;
      await this.sendMessageToUser(referrerId, {
        text: msg,
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.warn('notifyReferrerCommission warning:', err.message);
    }
  }
}

module.exports = new MainBotService();
