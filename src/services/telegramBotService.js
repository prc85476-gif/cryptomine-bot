const { Bot } = require('node-telegram-bot-api');
const payoutService = require('./payoutService');
const dbService = require('./dbService');
const mainBotService = require('./mainBotService');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.adminChatId = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) || process.env.ADMIN_CHAT_ID : null;
    this.pendingWithdrawals = new Map();
    this.isInitialized = false;
  }

  init() {
    const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8736676113:AAEbK8OCu4BexMZOz9xsVGHqXXoEnOs4_SM';
    if (!token || token.trim() === '' || token.includes('YOUR_BOT_TOKEN')) {
      console.warn('⚠️ Telegram Bot Token is not set in .env. Bot notifications will be skipped.');
      return;
    }

    try {
      this.bot = new Bot(token.trim());
      this.registerHandlers();
      
      // Start polling asynchronously without blocking
      this.bot.startPolling().catch((err) => {
        console.warn('⚠️ Telegram polling stopped or failed:', err.message);
      });

      this.isInitialized = true;
      console.log('🤖 Telegram Admin Bot initialized & connected with Neon DB (@acryptomintadminwithdraw2bot)...');
    } catch (err) {
      console.error('❌ Failed to initialize Telegram Bot:', err.message);
    }
  }

  registerHandlers() {
    if (!this.bot) return;

    // /start command
    this.bot.command('start', async (ctx) => {
      try {
        const chatId = ctx.chatId;
        const from = ctx.from;
        const userId = from?.id;
        const username = from?.username ? `@${from.username}` : from?.first_name || 'Admin';

        // Check if user is banned
        if (userId) {
          const isBanned = await dbService.isUserBanned(userId);
          if (isBanned) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '🚫 <b>Your account has been suspended by the administrator.</b>\nYou are restricted from using this bot and the Mini App.',
              parse_mode: 'HTML'
            });
            return;
          }
        }

        // Automatically set as admin if not already configured
        if (!this.adminChatId) {
          this.adminChatId = chatId;
          console.log(`📌 Admin Chat ID automatically set to: ${chatId}`);
        }

        // Register or fetch user in Neon DB
        if (from?.id) {
          await dbService.getUser(from.id, {
            username: from.username || `user_${from.id}`,
            firstName: from.first_name || 'Miner',
            lastName: from.last_name || ''
          }).catch(() => {});
        }

        const walletInfo = await payoutService.getWalletInfo();

        let walletStatus = '';
        if (walletInfo.configured) {
          walletStatus = `
💼 <b>Payout Hot Wallet (BEP-20):</b>
📍 <code>${walletInfo.address}</code>
💎 <b>USDT:</b> <code>${walletInfo.usdtBalance} USDT</code>
⛽ <b>BNB Gas:</b> <code>${walletInfo.bnbBalance} BNB</code>
🔗 <a href="${walletInfo.bscScanUrl}">View on BscScan</a>`;
        } else {
          walletStatus = `
⚠️ <b>Payout Wallet Status:</b> Not configured yet.
<i>Please add <code>PAYOUT_WALLET_PRIVATE_KEY</code> in your <code>.env</code> file.</i>`;
        }

        const welcomeMsg = `👋 <b>Welcome ${username}!</b>

🛡️ <b>CryptoMine Admin Bot (Withdrawals & Deposit Alerts)</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Your Chat ID:</b> <code>${chatId}</code>
${this.adminChatId == chatId ? '✅ <b>Role:</b> Active Admin (Receiving Alerts)' : 'ℹ️ Type /setadmin to set this chat as primary admin.'}
${walletStatus}
━━━━━━━━━━━━━━━━━━━━
<b>Available Admin Commands:</b>
• /balance - Check hot-wallet USDT & BNB Gas
• /setadmin - Set this chat for instant alerts
• /ban &lt;uid&gt; - Ban any malicious user
• /unban &lt;uid&gt; - Unban a user
• /help - Bot usage & payout guide`;

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: welcomeMsg,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💼 Check Wallet Balance', callback_data: 'cmd_balance' }],
              [{ text: '🔄 Refresh Status', callback_data: 'cmd_status' }]
            ]
          }
        });
      } catch (err) {
        console.error('Error handling /start:', err.message);
      }
    });

    // /balance command
    this.bot.command('balance', async (ctx) => {
      try {
        await this.sendBalanceMessage(ctx.chatId);
      } catch (err) {
        console.error('Error handling /balance:', err.message);
      }
    });

    // /setadmin command
    this.bot.command('setadmin', async (ctx) => {
      try {
        this.adminChatId = ctx.chatId;
        await this.bot.api.sendMessage({
          chat_id: ctx.chatId,
          text: `✅ <b>Admin Chat ID Updated!</b>\nAll withdrawal requests & deposit alerts will now be sent here (ID: <code>${ctx.chatId}</code>).`,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.error('Error handling /setadmin:', err.message);
      }
    });

    // /ban command: /ban <userId>
    this.bot.command('ban', async (ctx) => {
      try {
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];

        if (!targetId || isNaN(targetId)) {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: '⚠️ <b>Usage:</b> <code>/ban &lt;Telegram_User_ID&gt;</code>\nExample: <code>/ban 9482103</code>',
            parse_mode: 'HTML'
          });
          return;
        }

        const bannedUser = await dbService.banUser(targetId);
        if (bannedUser) {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: `🚫 <b>USER BANNED SUCCESSFULLY!</b>\n\n👤 <b>User:</b> @${bannedUser.username} (<code>${bannedUser.telegramId}</code>)\n📛 <b>Name:</b> ${bannedUser.name}\n🔒 <i>This account is now blocked from the Mini App and Bot.</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Unban Account', callback_data: `unban:${targetId}` }]
              ]
            }
          });
        } else {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: `⚠️ User with ID <code>${targetId}</code> not found in database.`,
            parse_mode: 'HTML'
          });
        }
      } catch (err) {
        console.error('Error handling /ban:', err.message);
      }
    });

    // /unban command: /unban <userId>
    this.bot.command('unban', async (ctx) => {
      try {
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];

        if (!targetId || isNaN(targetId)) {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: '⚠️ <b>Usage:</b> <code>/unban &lt;Telegram_User_ID&gt;</code>\nExample: <code>/unban 9482103</code>',
            parse_mode: 'HTML'
          });
          return;
        }

        const unbannedUser = await dbService.unbanUser(targetId);
        if (unbannedUser) {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: `✅ <b>USER UNBANNED SUCCESSFULLY!</b>\n\n👤 <b>User:</b> @${unbannedUser.username} (<code>${unbannedUser.telegramId}</code>)\n📛 <b>Name:</b> ${unbannedUser.name}\n🔓 <i>Access has been fully restored.</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚫 Ban Account', callback_data: `ban:${targetId}` }]
              ]
            }
          });
        } else {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: `⚠️ User with ID <code>${targetId}</code> not found in database.`,
            parse_mode: 'HTML'
          });
        }
      } catch (err) {
        console.error('Error handling /unban:', err.message);
      }
    });

    // /help command
    this.bot.command('help', async (ctx) => {
      try {
        const helpMsg = `📖 <b>Admin Bot Guide:</b>
━━━━━━━━━━━━━━━━━━━━
1. 📥 <b>Withdrawal Requests:</b> When a user withdraws, you get a clean alert here with user details and <b>[Approve & Pay]</b> & <b>[Reject]</b> buttons.
2. 💸 <b>Automatic Payout & User Alert:</b> Clicking <b>[Approve & Pay]</b> completes the payout, records the TxID, and sends the user their BscScan confirmation card.
3. 🚫 <b>Account Ban Control:</b> Clicking <b>[Ban Account]</b> immediately locks malicious users from accessing the Mini App and Bot.
4. 🔄 <b>Refund on Reject:</b> Clicking <b>[Reject]</b> automatically cancels withdrawal and refunds user balance in Neon DB.`;

        await this.bot.api.sendMessage({
          chat_id: ctx.chatId,
          text: helpMsg,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.error('Error handling /help:', err.message);
      }
    });

    // Callback query handler (Approve / Reject / Ban / Unban)
    this.bot.on('callback_query', async (ctx) => {
      try {
        const callbackQuery = ctx.callbackQuery;
        if (!callbackQuery) return;

        const data = callbackQuery.data;
        const chatId = callbackQuery.message?.chat?.id || ctx.chatId;
        const messageId = callbackQuery.message?.message_id;

        if (data === 'cmd_balance' || data === 'cmd_status') {
          await this.sendBalanceMessage(chatId);
          await this.bot.api.answerCallbackQuery({ callback_query_id: callbackQuery.id });
          return;
        }

        const [action, targetId] = data.split(':');
        if (!action || !targetId) {
          await this.bot.api.answerCallbackQuery({ callback_query_id: callbackQuery.id });
          return;
        }

        // --- BAN ACTION ---
        if (action === 'ban') {
          await dbService.banUser(targetId);
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: `🚫 Account #${targetId} has been BANNED!`,
            show_alert: true
          });

          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `🚫 <b>ACCOUNT BANNED:</b> User ID <code>${targetId}</code> is now blocked from the Mini App and Bot.`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Unban Account', callback_data: `unban:${targetId}` }]
              ]
            }
          });
          return;
        }

        // --- UNBAN ACTION ---
        if (action === 'unban') {
          await dbService.unbanUser(targetId);
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: `✅ Account #${targetId} has been UNBANNED!`,
            show_alert: true
          });

          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `✅ <b>ACCOUNT RESTORED:</b> User ID <code>${targetId}</code> can now use the Mini App and Bot.`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚫 Ban Account', callback_data: `ban:${targetId}` }]
              ]
            }
          });
          return;
        }

        // --- WITHDRAWAL APPROVAL & REJECTION ACTIONS ---
        const txId = targetId;
        const withdrawal = this.pendingWithdrawals.get(txId);
        if (!withdrawal) {
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: '⚠️ This withdrawal request has already been processed or expired.',
            show_alert: true
          });
          return;
        }

        if (withdrawal.status !== 'Pending') {
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: `⚠️ Request already ${withdrawal.status}.`,
            show_alert: true
          });
          return;
        }

        if (action === 'approve') {
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: '⏳ Initiating On-Chain Transfer...'
          });

          // Edit admin message to processing state
          await this.bot.api.editMessageText({
            chat_id: chatId,
            message_id: messageId,
            text: `⏳ <b>Processing On-Chain Payout...</b>\n━━━━━━━━━━━━━━━━━━━━\n🆔 <b>Tx ID:</b> <code>${txId}</code>\n💎 <b>Sending:</b> <code>${withdrawal.finalReceived} USDT (BEP20)</code>\n📍 <b>To:</b> <code>${withdrawal.address}</code>\n<i>Connecting to BNB Smart Chain...</i>`,
            parse_mode: 'HTML'
          });

          try {
            // Execute on-chain payout
            const payoutResult = await payoutService.transferUsdt({
              toAddress: withdrawal.address,
              amount: withdrawal.finalReceived,
              txId: txId
            });

            withdrawal.status = 'Completed';
            withdrawal.txHash = payoutResult.txHash;
            this.pendingWithdrawals.set(txId, withdrawal);

            // Update in Neon Database
            await dbService.updateTransaction(txId, {
              status: 'Completed',
              txHash: payoutResult.txHash
            });

            // 💸 Notify USER on their Telegram Bot with full BscScan card preview & direct link!
            mainBotService.notifyUserWithdrawalApproved(withdrawal.userId, {
              amount: withdrawal.amount,
              finalReceived: withdrawal.finalReceived,
              fee: withdrawal.fee,
              address: withdrawal.address,
              txHash: payoutResult.txHash,
              bscScanUrl: payoutResult.bscScanUrl
            }).catch((e) => console.warn('Could not notify user on approval:', e.message));

            // Clean concise summary for Admin Bot (no BscScan preview/card on admin chat, goes to user)
            const adminSuccessText = `✅ <b>WITHDRAWAL APPROVED & PAID!</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Tx ID:</b> <code>${txId}</code>
👤 <b>User:</b> @${withdrawal.username} (ID: <code>${withdrawal.userId}</code>)
💰 <b>Amount Sent:</b> <code>${withdrawal.finalReceived} USDT</code> (Fee: ${withdrawal.fee} USDT)
🌐 <b>Network:</b> BEP-20 (BNB Smart Chain)
📍 <b>Destination:</b> <code>${withdrawal.address}</code>
━━━━━━━━━━━━━━━━━━━━
⚡ <i>Payout completed! User has been sent their BscScan transaction link and confirmation card.</i>`;

            await this.bot.api.editMessageText({
              chat_id: chatId,
              message_id: messageId,
              text: adminSuccessText,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚫 Ban User', callback_data: `ban:${withdrawal.userId}` }]
                ]
              }
            });

          } catch (payoutErr) {
            console.error('❌ On-Chain Payout Error:', payoutErr.message);

            const errorText = `❌ <b>PAYOUT EXECUTION FAILED!</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Tx ID:</b> <code>${txId}</code>
👤 <b>User:</b> ${withdrawal.username}
💰 <b>Amount:</b> <code>${withdrawal.finalReceived} USDT</code>
📍 <b>To Address:</b> <code>${withdrawal.address}</code>
⚠️ <b>Error Reason:</b>
<code>${payoutErr.message}</code>
━━━━━━━━━━━━━━━━━━━━
<i>Check your wallet BNB gas / USDT balance and retry, or reject & refund.</i>`;

            await this.bot.api.editMessageText({
              chat_id: chatId,
              message_id: messageId,
              text: errorText,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Retry Payout', callback_data: `approve:${txId}` }],
                  [{ text: '❌ Reject & Refund', callback_data: `reject:${txId}` }],
                  [{ text: '🚫 Ban User', callback_data: `ban:${withdrawal.userId}` }]
                ]
              }
            });
          }

        } else if (action === 'reject') {
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: '❌ Request Rejected. Balance refunded.'
          });

          withdrawal.status = 'Rejected';
          this.pendingWithdrawals.set(txId, withdrawal);

          // Refund user balance in Neon Database
          try {
            const user = await dbService.getUser(withdrawal.userId);
            const newBal = parseFloat((user.balance + withdrawal.amount).toFixed(4));
            const newWithdrawn = parseFloat(Math.max(0, user.totalWithdrawn - withdrawal.amount).toFixed(4));

            await dbService.updateUser(withdrawal.userId, {
              balance: newBal,
              totalWithdrawn: newWithdrawn
            });

            await dbService.updateTransaction(txId, {
              status: 'Rejected'
            });

            // Notify User on Telegram that withdrawal was rejected & refunded
            mainBotService.notifyUserWithdrawalRejected(withdrawal.userId, withdrawal.amount).catch(() => {});
          } catch (dbErr) {
            console.error('Error refunding in Neon DB:', dbErr.message);
          }

          const rejectText = `❌ <b>WITHDRAWAL REJECTED (Refunded in Neon DB)</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Tx ID:</b> <code>${txId}</code>
👤 <b>User:</b> ${withdrawal.username} (ID: <code>${withdrawal.userId}</code>)
💰 <b>Refunded Amount:</b> <code>${withdrawal.amount} USDT</code>
📍 <b>Target Address:</b> <code>${withdrawal.address}</code>
━━━━━━━━━━━━━━━━━━━━
🔄 <i>The requested amount has been refunded back to user's withdrawable balance in Neon DB.</i>`;

          await this.bot.api.editMessageText({
            chat_id: chatId,
            message_id: messageId,
            text: rejectText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚫 Ban User', callback_data: `ban:${withdrawal.userId}` }]
              ]
            }
          });
        }
      } catch (err) {
        console.error('Error handling callback query:', err.message);
      }
    });
  }

  async sendBalanceMessage(chatId) {
    if (!this.bot) return;
    const walletInfo = await payoutService.getWalletInfo();

    if (walletInfo.configured) {
      const msg = `💼 <b>Payout Hot Wallet (BEP-20)</b>
━━━━━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>${walletInfo.address}</code>
💎 <b>USDT Balance:</b> <code>${walletInfo.usdtBalance} USDT</code>
⛽ <b>BNB Gas Balance:</b> <code>${walletInfo.bnbBalance} BNB</code>
━━━━━━━━━━━━━━━━━━━━
• 🔍 <a href="${walletInfo.bscScanUrl}"><b>View Wallet on BscScan</b></a>`;

      await this.bot.api.sendMessage({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 View on BscScan', url: walletInfo.bscScanUrl }],
            [{ text: '🔄 Refresh Balance', callback_data: 'cmd_balance' }]
          ]
        }
      });
    } else {
      await this.bot.api.sendMessage({
        chat_id: chatId,
        text: `⚠️ <b>Payout Wallet Not Configured!</b>\n<code>${walletInfo.error}</code>\n\nPlease add your <code>PAYOUT_WALLET_PRIVATE_KEY</code> in the <code>.env</code> file.`,
        parse_mode: 'HTML'
      });
    }
  }

  /**
   * Send Instant Deposit Alert with BscScan Preview Link and Ban / Unban Buttons
   */
  async notifyDepositAlert(depositData) {
    const {
      userId,
      username,
      name,
      amount,
      network,
      txHash,
      depositBalance,
      mainBalance,
      totalDeposited,
      totalReferrals
    } = depositData;

    if (!this.bot) {
      console.warn('⚠️ Telegram bot not initialized. Cannot send deposit alert.');
      return;
    }

    const targetChatId = this.adminChatId || process.env.ADMIN_CHAT_ID;
    if (!targetChatId) {
      console.warn('⚠️ No Admin Chat ID configured yet. Please open the bot (@acryptomintadminwithdraw2bot) and send /start to link.');
      return;
    }

    const cleanTxHash = txHash ? txHash.trim() : 'N/A';
    const isUrl = cleanTxHash.startsWith('http://') || cleanTxHash.startsWith('https://');
    const bscScanUrl = isUrl ? cleanTxHash : `https://bscscan.com/tx/${cleanTxHash}`;
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    const alertMessage = `📥 <b>🚨 NEW DEPOSIT ALERT!</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Username:</b> @${username || 'N/A'}
🆔 <b>UID:</b> <code>${userId}</code>
📛 <b>Name:</b> ${name || 'Alex Miner'}
💰 <b>Deposit Amount:</b> <code>+${parseFloat(amount).toFixed(2)} USDT</code>
🌐 <b>Network:</b> ${network || 'USDT BEP-20'}
👥 <b>Total Referrals:</b> ${totalReferrals || 0} Users
🛍️ <b>NFT / Deposit Balance:</b> <code>${parseFloat(depositBalance || 0).toFixed(2)} USDT</code>
💎 <b>Withdrawable Balance:</b> <code>${parseFloat(mainBalance || 0).toFixed(4)} USDT</code>
📈 <b>Total Deposited:</b> <code>${parseFloat(totalDeposited || 0).toFixed(2)} USDT</code>
━━━━━━━━━━━━━━━━━━━━
• 🔗 <b>TXID:</b>
<code>${cleanTxHash}</code>
• 🔍 <a href="${bscScanUrl}"><b>View on BscScan</b></a>
• 🟢 <b>Status:</b> ON-CHAIN VERIFIED & CREDITED
• ⏰ <b>Time:</b> ${nowUtc}
━━━━━━━━━━━━━━━━━━━━
👇 <b>Choose an action below:</b>`;

    const options = {
      chat_id: targetChatId,
      text: alertMessage,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔍 View on BscScan', url: bscScanUrl }
          ],
          [
            { text: '🚫 Ban Account', callback_data: `ban:${userId}` },
            { text: '✅ Unban Account', callback_data: `unban:${userId}` }
          ]
        ]
      }
    };

    try {
      const sent = await this.bot.api.sendMessage(options);
      return sent;
    } catch (err) {
      console.error('❌ Failed to send Telegram deposit alert:', err.message);
    }
  }

  /**
   * Send Clean Withdrawal Request to Admin Telegram (No BscScan preview on pending admin request)
   */
  async notifyWithdrawalRequest(withdrawalData) {
    const { txId, userId, username, amount, fee, finalReceived, address, network } = withdrawalData;

    // Save to pending map
    this.pendingWithdrawals.set(txId, {
      ...withdrawalData,
      status: 'Pending',
      createdAt: new Date()
    });

    if (!this.bot) {
      console.warn('⚠️ Telegram bot not initialized. Cannot send withdrawal alert.');
      return;
    }

    const targetChatId = this.adminChatId || process.env.ADMIN_CHAT_ID;
    if (!targetChatId) {
      console.warn('⚠️ No Admin Chat ID configured yet. Please open the Telegram bot and send /start to link your chat ID.');
      return;
    }

    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    const alertMessage = `🚨 <b>NEW WITHDRAWAL REQUEST</b> 🚨
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Tx ID:</b> <code>${txId}</code>
👤 <b>User:</b> @${username || 'Anonymous'} (UID: <code>${userId}</code>)
💵 <b>Requested Amount:</b> <code>${amount.toFixed(4)} USDT</code>
⛽ <b>Network Fee:</b> <code>${fee.toFixed(4)} USDT</code>
💎 <b>Net to Send:</b> <code>${finalReceived.toFixed(4)} USDT</code>
🌐 <b>Network:</b> ${network || 'BEP-20 (BNB Chain)'}
📍 <b>Destination Wallet:</b>
<code>${address}</code>
⏰ <b>Time:</b> ${nowUtc}
━━━━━━━━━━━━━━━━━━━━
<i>Click Approve & Pay to execute payout.</i>`;

    const options = {
      chat_id: targetChatId,
      text: alertMessage,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve & Pay', callback_data: `approve:${txId}` },
            { text: '❌ Reject', callback_data: `reject:${txId}` }
          ],
          [
            { text: '🚫 Ban User', callback_data: `ban:${userId}` }
          ]
        ]
      }
    };

    try {
      const sent = await this.bot.api.sendMessage(options);
      return sent;
    } catch (err) {
      console.error('❌ Failed to send Telegram withdrawal alert:', err.message);
    }
  }
}

module.exports = new TelegramBotService();
