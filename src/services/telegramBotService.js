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
    this.isPollingActive = false;
    this.lastUsdtAlertThreshold = null; // Tracks last alerted USDT threshold (5, 4, 3, 2, 1, 0)
    this.lastBnbAlertState = null; // Tracks 'empty', 'low', 'ok'
    this.monitorInterval = null;
  }

  init() {
    const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8736676113:AAEbK8OCu4BexMZOz9xsVGHqXXoEnOs4_SM';
    if (!token || token.trim() === '' || token.includes('YOUR_BOT_TOKEN')) {
      console.warn('⚠️ Telegram Bot Token is not set in .env. Bot notifications will be skipped.');
      return;
    }

    try {
      this.bot = new Bot(token.trim());

      // Global error handler to prevent crashing or polling stoppage
      this.bot.catch((err) => {
        console.error('⚠️ [Admin Bot] Internal update handler error:', err.message || err);
      });

      this.registerHandlers();
      this.startPollingLoop();

      this.isInitialized = true;
      console.log('🤖 Telegram Admin Bot initialized & connected with Neon DB (@acryptomintadminwithdraw2bot)...');

      // Start periodic background wallet health & gas fee monitor (every 10 mins)
      if (this.monitorInterval) clearInterval(this.monitorInterval);
      this.monitorInterval = setInterval(() => {
        this.runPeriodicWalletHealthCheck().catch(() => {});
      }, 10 * 60 * 1000);

    } catch (err) {
      console.error('❌ Failed to initialize Telegram Bot:', err.message);
    }
  }

  async startPollingLoop() {
    if (this.isPollingActive) return;
    this.isPollingActive = true;

    while (this.isPollingActive) {
      try {
        console.log('🔄 [Admin Bot] Starting Telegram getUpdates polling...');
        await this.bot.startPolling(undefined, {
          dropPendingUpdates: false,
          allowedUpdates: ['message', 'callback_query']
        });
      } catch (err) {
        console.warn('⚠️ [Admin Bot] Polling connection notice:', err.message || err, '— Reconnecting in 3s...');
      }
      // Auto-reconnect delay
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  isAuthorizedAdmin(from) {
    if (!from) return false;
    const username = (from.username || '').replace(/^@/, '').toLowerCase();
    const userId = from.id;

    // Strict Authorization: ONLY @ownerof421 (case-insensitive) can access
    if (username === 'ownerof421') return true;

    // If explicit admin username is configured in environment
    if (process.env.ADMIN_USERNAME && username === process.env.ADMIN_USERNAME.replace(/^@/, '').toLowerCase()) {
      return true;
    }

    // If explicit admin chat ID is configured in environment
    if (process.env.ADMIN_CHAT_ID && String(userId) === String(process.env.ADMIN_CHAT_ID)) {
      return true;
    }

    return false;
  }

  registerHandlers() {
    if (!this.bot) return;

    // Common Admin Dashboard Dispatcher
    const handleDashboard = async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        const from = ctx.from;
        const userId = from?.id;

        if (!chatId) return;

        // Strict Authorization Guard: Only @ownerof421
        if (!this.isAuthorizedAdmin(from)) {
          console.warn(`⛔ [Admin Bot] Unauthorized access attempt by ${from?.username || from?.id} (Chat ID: ${chatId})`);
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: '⛔ <b>Access Denied!</b>\nThis Admin Control Bot is strictly restricted. Only <b>@ownerof421</b> is authorized to access and control this system.',
            parse_mode: 'HTML'
          });
          return;
        }

        // Set as active adminChatId for alerts and notifications
        this.adminChatId = chatId;

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

        // Register or fetch user in Neon DB
        if (from?.id) {
          await dbService.getUser(from.id, {
            username: from.username || `user_${from.id}`,
            firstName: from.first_name || 'Admin',
            lastName: from.last_name || ''
          }).catch(() => {});
        }

        await this.sendAdminDashboard(chatId);
      } catch (err) {
        console.error('Error handling dashboard command:', err.message);
      }
    };

    // Slash command registrations
    this.bot.command('start', handleDashboard);
    this.bot.command('admin', handleDashboard);
    this.bot.command('dashboard', handleDashboard);
    this.bot.command('stats', handleDashboard);

    // /balance command: Hot-wallet & Gas fee status
    this.bot.command('balance', async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (chatId) await this.sendBalanceMessage(chatId);
      } catch (err) {
        console.error('Error handling /balance:', err.message);
      }
    });

    // /pending command: View pending withdrawals
    this.bot.command('pending', async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (chatId) await this.sendPendingWithdrawalsMessage(chatId);
      } catch (err) {
        console.error('Error handling /pending:', err.message);
      }
    });

    // /setadmin command
    this.bot.command('setadmin', async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (!chatId) return;
        this.adminChatId = chatId;
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: `✅ <b>Admin Chat ID Updated!</b>\nAll withdrawal requests, dashboard updates & risk alerts will now be sent here (ID: <code>${chatId}</code>).`,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.error('Error handling /setadmin:', err.message);
      }
    });

    // /testchannel command: Test posting to @cryptomintwithdraw proof channel
    this.bot.command('testchannel', async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (!chatId) return;
        await this.broadcastWithdrawalToProofChannel({
          username: ctx.from?.username || 'ownerof421',
          amount: 0.2600,
          fromAddress: '0x9cccFDFfa030A90bEBd73c7dB610B5E05Eb8Bd040a6',
          toAddress: '0xc1e779a78e778401fa9bb270d4c82b9a71726bd',
          txHash: '0x932070f170ae4930c8e86d71a7dd993e06fea72d24ac5afbfd1d6af7174cc1ce',
          bscScanUrl: 'https://bscscan.com/tx/0x932070f170ae4930c8e86d71a7dd993e06fea72d24ac5afbfd1d6af7174cc1ce'
        });

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: '✅ <b>Test message broadcasted to @cryptomintwithdraw channel!</b>',
          parse_mode: 'HTML'
        });
      } catch (err) {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (chatId) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `❌ <b>Failed to post to channel:</b> <code>${err.message}</code>\n\nEnsure @acryptomintadminwithdraw2bot is an Admin in @cryptomintwithdraw with post permission.`,
            parse_mode: 'HTML'
          });
        }
      }
    });

    // /ban command: /ban <userId>
    this.bot.command('ban', async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (!chatId) return;
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];

        if (!targetId || isNaN(targetId)) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: '⚠️ <b>Usage:</b> <code>/ban &lt;Telegram_User_ID&gt;</code>\nExample: <code>/ban 9482103</code>',
            parse_mode: 'HTML'
          });
          return;
        }

        const bannedUser = await dbService.banUser(targetId);
        if (bannedUser) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
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
            chat_id: chatId,
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
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (!chatId) return;
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];

        if (!targetId || isNaN(targetId)) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: '⚠️ <b>Usage:</b> <code>/unban &lt;Telegram_User_ID&gt;</code>\nExample: <code>/unban 9482103</code>',
            parse_mode: 'HTML'
          });
          return;
        }

        const unbannedUser = await dbService.unbanUser(targetId);
        if (unbannedUser) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
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
            chat_id: chatId,
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
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) {
          if (chatId) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '⛔ <b>Access Denied!</b>\nOnly <b>@ownerof421</b> can access this bot.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
        if (!chatId) return;
        const helpMsg = `📖 <b>Admin Bot Master Guide:</b>
━━━━━━━━━━━━━━━━━━━━
1. 🛡️ <b>/start & /admin:</b> Live Master Admin Dashboard with all system metrics, user balances, deposits, approved/pending withdrawals, and wallet gas status.
2. 📥 <b>Withdrawal Approval:</b> When a user requests withdrawal, you get an instant card with <b>[Approve & Pay]</b> and <b>[Reject]</b>.
3. 💸 <b>On-Chain Auto Payout:</b> Clicking <b>[Approve & Pay]</b> triggers instant BEP20 USDT payout, broadcasts to @cryptomintwithdraw, and notifies the user.
4. 🚨 <b>Risk Alerts:</b> Automatic instant notification when Master Wallet USDT balance drops <= $5 (and step updates at $4, $3, $2, $1) or when BNB gas is low/exhausted.
5. 🚫 <b>User Ban Control:</b> Use <code>/ban &lt;UID&gt;</code> and <code>/unban &lt;UID&gt;</code> to manage users.`;

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: helpMsg,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.error('Error handling /help:', err.message);
      }
    });

    // Fallback message handler for raw text commands
    this.bot.on('message:text', async (ctx) => {
      const text = (ctx.message?.text || '').trim();
      if (text === '/start' || text.startsWith('/start') || text === '/admin' || text === '/dashboard' || text === '/stats') {
        await handleDashboard(ctx);
      }
    });

    // Callback query handler
    this.bot.on('callback_query', async (ctx) => {
      try {
        const callbackQuery = ctx.callbackQuery || ctx.update?.callback_query;
        if (!callbackQuery) return;

        const data = callbackQuery.data;
        const chatId = callbackQuery.message?.chat?.id || ctx.chatId || ctx.from?.id;
        const messageId = callbackQuery.message?.message_id;
        const from = callbackQuery.from;

        // Strict authorization check for callbacks
        if (!this.isAuthorizedAdmin(from)) {
          console.warn(`⛔ [Admin Bot] Unauthorized callback attempt by ${from?.username || from?.id}`);
          await this.bot.api.answerCallbackQuery({
            callback_query_id: callbackQuery.id,
            text: '⛔ Access Denied! Only @ownerof421 is authorized.',
            show_alert: true
          }).catch(() => {});
          return;
        }

        // Answer callback query immediately to stop UI loading spinner
        await this.bot.api.answerCallbackQuery({
          callback_query_id: callbackQuery.id
        }).catch(() => {});

        if (!data) return;

        // Navigation callbacks
        if (data === 'cmd_dashboard' || data === 'cmd_status' || data === 'cmd_refresh') {
          await this.sendAdminDashboard(chatId, messageId);
          return;
        }

        if (data === 'cmd_balance') {
          await this.sendBalanceMessage(chatId);
          return;
        }

        if (data === 'cmd_pending') {
          await this.sendPendingWithdrawalsMessage(chatId);
          return;
        }

        if (data === 'cmd_testchannel') {
          try {
            await this.broadcastWithdrawalToProofChannel({
              username: callbackQuery.from?.username || 'admin_test',
              amount: 0.2600,
              fromAddress: '0x9cccFDFfa030A90bEBd73c7dB610B5E05Eb8Bd040a6',
              toAddress: '0xc1e779a78e778401fa9bb270d4c82b9a71726bd',
              txHash: '0x932070f170ae4930c8e86d71a7dd993e06fea72d24ac5afbfd1d6af7174cc1ce',
              bscScanUrl: 'https://bscscan.com/tx/0x932070f170ae4930c8e86d71a7dd993e06fea72d24ac5afbfd1d6af7174cc1ce'
            });
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: '✅ <b>Test message broadcasted to @cryptomintwithdraw proof channel!</b>',
              parse_mode: 'HTML'
            });
          } catch (e) {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `❌ <b>Failed to post to channel:</b> <code>${e.message}</code>`,
              parse_mode: 'HTML'
            });
          }
          return;
        }

        const [action, targetId] = data.split(':');
        if (!action || !targetId) return;

        // --- BAN ACTION ---
        if (action === 'ban') {
          await dbService.banUser(targetId);
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
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: '⚠️ This withdrawal request has already been processed or expired.',
            parse_mode: 'HTML'
          });
          return;
        }

        if (withdrawal.status !== 'Pending') {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `⚠️ Request <code>${txId}</code> was already ${withdrawal.status}.`,
            parse_mode: 'HTML'
          });
          return;
        }

        if (action === 'approve') {
          // Edit admin message to processing state
          if (messageId) {
            await this.bot.api.editMessageText({
              chat_id: chatId,
              message_id: messageId,
              text: `⏳ <b>Processing On-Chain Payout...</b>\n━━━━━━━━━━━━━━━━━━━━\n🆔 <b>Tx ID:</b> <code>${txId}</code>\n💎 <b>Sending:</b> <code>${withdrawal.finalReceived} USDT (BEP20)</code>\n📍 <b>To:</b> <code>${withdrawal.address}</code>\n<i>Connecting to BNB Smart Chain...</i>`,
              parse_mode: 'HTML'
            }).catch(() => {});
          }

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

            // 📢 Auto Broadcast to @cryptomintwithdraw payment proof channel
            this.broadcastWithdrawalToProofChannel({
              username: withdrawal.username,
              amount: withdrawal.finalReceived,
              fromAddress: payoutResult.sender || '0x9cccFDFfa030A90bEBd73c7dB610B5E05Eb8Bd040a6',
              toAddress: withdrawal.address,
              txHash: payoutResult.txHash,
              bscScanUrl: payoutResult.bscScanUrl
            }).catch((e) => console.warn('Proof channel broadcast error:', e.message));

            // Clean concise summary for Admin Bot
            const adminSuccessText = `✅ <b>WITHDRAWAL APPROVED & PAID!</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Tx ID:</b> <code>${txId}</code>
👤 <b>User:</b> @${withdrawal.username} (ID: <code>${withdrawal.userId}</code>)
💰 <b>Amount Sent:</b> <code>${withdrawal.finalReceived} USDT</code> (Fee: ${withdrawal.fee} USDT)
🌐 <b>Network:</b> BEP-20 (BNB Smart Chain)
📍 <b>Destination:</b> <code>${withdrawal.address}</code>
━━━━━━━━━━━━━━━━━━━━
⚡ <i>Payout completed! User has been sent their BscScan transaction link and confirmation card.</i>`;

            if (messageId) {
              await this.bot.api.editMessageText({
                chat_id: chatId,
                message_id: messageId,
                text: adminSuccessText,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🚫 Ban User', callback_data: `ban:${withdrawal.userId}` }],
                    [{ text: '🔄 Admin Dashboard', callback_data: 'cmd_dashboard' }]
                  ]
                }
              });
            } else {
              await this.bot.api.sendMessage({
                chat_id: chatId,
                text: adminSuccessText,
                parse_mode: 'HTML',
                disable_web_page_preview: true
              });
            }

            // Trigger real-time wallet risk alert check after payout
            setTimeout(() => {
              this.runPeriodicWalletHealthCheck().catch(() => {});
            }, 3000);

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

            if (messageId) {
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

            // Trigger wallet alert check on failure
            this.runPeriodicWalletHealthCheck().catch(() => {});
          }

        } else if (action === 'reject') {
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

          if (messageId) {
            await this.bot.api.editMessageText({
              chat_id: chatId,
              message_id: messageId,
              text: rejectText,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚫 Ban User', callback_data: `ban:${withdrawal.userId}` }],
                  [{ text: '🔄 Admin Dashboard', callback_data: 'cmd_dashboard' }]
                ]
              }
            });
          }
        }
      } catch (err) {
        console.error('Error handling callback query:', err.message);
      }
    });
  }

  /**
   * Render and send/edit the Complete Master Admin Dashboard
   */
  async sendAdminDashboard(chatId, messageId = null) {
    if (!this.bot) return;

    try {
      const stats = await dbService.getAdminSystemStats();
      const walletInfo = await payoutService.getWalletInfo();

      const usdtVal = parseFloat(walletInfo.usdtBalance || 0);
      const bnbVal = parseFloat(walletInfo.bnbBalance || 0);

      // Status badges
      let usdtBadge = '🟢 Healthy';
      if (!walletInfo.configured) {
        usdtBadge = '⚪ Not Configured';
      } else if (usdtVal <= 1.0) {
        usdtBadge = '🚨 CRITICAL LOW (< $1)';
      } else if (usdtVal <= 5.0) {
        usdtBadge = `⚠️ LOW FUND ALERT ($${usdtVal.toFixed(2)})`;
      }

      let bnbBadge = '🟢 Gas OK';
      if (!walletInfo.configured) {
        bnbBadge = '⚪ Not Configured';
      } else if (bnbVal <= 0.0005) {
        bnbBadge = '🚨 GAS DEPLETED (0 BNB)';
      } else if (bnbVal < 0.003) {
        bnbBadge = `⚠️ LOW GAS (${bnbVal.toFixed(5)} BNB)`;
      }

      const nowTimeStr = new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });

      const dashboardText = `🛡️ <b>CRYPTOMINE MASTER ADMIN DASHBOARD</b>
━━━━━━━━━━━━━━━━━━━━
👥 <b>USER BASE OVERVIEW:</b>
• 👤 <b>Total Registered Users:</b> <code>${stats.totalUsers}</code>
• ⚡ <b>Active Users (24h):</b> <code>${stats.activeUsers24h}</code>
• 🚫 <b>Banned Accounts:</b> <code>${stats.bannedUsers}</code>

💰 <b>FINANCIAL & BALANCES (SYSTEM):</b>
• 💎 <b>Total User Balance (Withdrawable):</b> <code>${stats.totalUserBalance} USDT</code>
• 🛍️ <b>Total Deposit / NFT Balance:</b> <code>${stats.totalDepositBalance} USDT</code>
• 💵 <b>Total Overall User Funds:</b> <code>${stats.totalUserFunds} USDT</code>

💼 <b>MASTER PAYOUT HOT WALLET:</b>
• 📍 <b>Address:</b> <code>${walletInfo.address || 'Not Configured (.env)'}</code>
• 💎 <b>USDT Balance:</b> <code>${walletInfo.usdtBalance || '0.0000'} USDT</code> [${usdtBadge}]
• ⛽ <b>BNB Gas Balance:</b> <code>${walletInfo.bnbBalance || '0.00000'} BNB</code> [${bnbBadge}]

📥 <b>DEPOSITS (ON-CHAIN):</b>
• 📈 <b>Total Deposited:</b> <code>+${stats.totalDepositedAmount} USDT</code> (<b>${stats.totalDepositsCount}</b> txs)

📤 <b>WITHDRAWALS & PAYOUTS:</b>
• ✅ <b>Total Approved & Paid:</b> <code>${stats.totalWithdrawnAmount} USDT</code> (<b>${stats.totalWithdrawnCount}</b> txs)
• ⏳ <b>Pending Requests:</b> <code>${stats.pendingWithdrawalsCount}</code> requests (<code>${stats.pendingWithdrawalsAmount} USDT</code>)

⛏️ <b>MINING & NFT MARKETPLACE:</b>
• 🤖 <b>Active Miners:</b> <code>${stats.totalActiveMiners}</code>
• 📦 <b>Purchased Plans:</b> <code>${stats.totalPurchasedPlans}</code>
• ⚡ <b>Daily Mining Output:</b> <code>${stats.totalDailyMiningRate} USDT/day</code>
━━━━━━━━━━━━━━━━━━━━
⏰ <b>Last Synced:</b> <i>${nowTimeStr} UTC</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Refresh Dashboard', callback_data: 'cmd_dashboard' },
            { text: '💼 Check Wallet', callback_data: 'cmd_balance' }
          ],
          [
            { text: `📋 Pending Requests (${stats.pendingWithdrawalsCount})`, callback_data: 'cmd_pending' },
            { text: '📢 Test Proof Post', callback_data: 'cmd_testchannel' }
          ],
          [
            { text: '🔍 View Hot Wallet on BscScan', url: walletInfo.bscScanUrl || 'https://bscscan.com' }
          ]
        ]
      };

      if (messageId) {
        await this.bot.api.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: dashboardText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        }).catch(async () => {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: dashboardText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: keyboard
          });
        });
      } else {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: dashboardText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });
      }

      // Check and send wallet risk alerts if needed
      this.checkAndSendWalletRiskAlerts(walletInfo, chatId).catch(() => {});

    } catch (err) {
      console.error('Error in sendAdminDashboard:', err);
    }
  }

  /**
   * Check Master Wallet Balances and send Risk SMS/Telegram Alerts to Admin
   */
  async checkAndSendWalletRiskAlerts(walletInfo, targetChatId = null) {
    if (!this.bot) return;
    const destChatId = targetChatId || this.adminChatId || process.env.ADMIN_CHAT_ID;
    if (!destChatId) return;

    if (!walletInfo || !walletInfo.configured) return;

    const usdtBal = parseFloat(walletInfo.usdtBalance || 0);
    const bnbBal = parseFloat(walletInfo.bnbBalance || 0);

    // 1. USDT Balance Risk Alert (<= $5.00, <= $4.00, <= $3.00, <= $2.00, <= $1.00, etc.)
    if (usdtBal <= 5.0) {
      const currentThreshold = Math.floor(usdtBal); // 5, 4, 3, 2, 1, 0
      if (this.lastUsdtAlertThreshold !== currentThreshold) {
        this.lastUsdtAlertThreshold = currentThreshold;

        const isCritical = usdtBal <= 1.0;
        const alertTitle = isCritical 
          ? `🚨 <b>CRITICAL WALLET FUND RISK ALERT!</b>` 
          : `⚠️ <b>WALLET FUND RISK ALERT: Master Payout Balance Low!</b>`;

        const usdtAlertMsg = `${alertTitle}
━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Abnormal Transaction Risk / Low Balance Warning!</b>
💰 <b>Current USDT Balance:</b> <code>${walletInfo.usdtBalance} USDT</code>
📍 <b>Payout Wallet:</b> <code>${walletInfo.address}</code>
━━━━━━━━━━━━━━━━━━━━
${isCritical 
  ? `❌ <b>CRITICAL:</b> Balance is critically low (<b>${walletInfo.usdtBalance} USDT</b>). Immediate deposit required to prevent payout execution failures!` 
  : `⚠️ <b>ALERT:</b> Master wallet balance has dropped below <b>$5.00 USDT</b> (Currently: <b>${walletInfo.usdtBalance} USDT</b>). Please replenish USDT to ensure uninterrupted automated payouts.`}
━━━━━━━━━━━━━━━━━━━━
🔗 <a href="${walletInfo.bscScanUrl}">View Payout Wallet on BscScan</a>`;

        await this.bot.api.sendMessage({
          chat_id: destChatId,
          text: usdtAlertMsg,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 View on BscScan', url: walletInfo.bscScanUrl }],
              [{ text: '🔄 Refresh Status', callback_data: 'cmd_dashboard' }]
            ]
          }
        }).catch((e) => console.warn('Could not send USDT risk alert:', e.message));
      }
    } else {
      this.lastUsdtAlertThreshold = null; // Reset when balance restored
    }

    // 2. BNB Gas Fee Alert (< 0.003 BNB or < 0.0005 BNB)
    if (bnbBal < 0.003) {
      const bnbState = bnbBal <= 0.0005 ? 'empty' : 'low';
      if (this.lastBnbAlertState !== bnbState) {
        this.lastBnbAlertState = bnbState;

        const isGasEmpty = bnbState === 'empty';
        const gasTitle = isGasEmpty 
          ? `🚨 <b>CRITICAL BNB GAS FEE ALERT: Gas Exhausted!</b>` 
          : `⛽ <b>BNB GAS FEE ALERT: Gas Balance Low!</b>`;

        const bnbAlertMsg = `${gasTitle}
━━━━━━━━━━━━━━━━━━━━
⛽ <b>Current BNB Gas Balance:</b> <code>${walletInfo.bnbBalance} BNB</code>
📍 <b>Payout Wallet:</b> <code>${walletInfo.address}</code>
━━━━━━━━━━━━━━━━━━━━
${isGasEmpty 
  ? `❌ <b>GAS EMPTY:</b> BNB balance is 0 or depleted (<b>${walletInfo.bnbBalance} BNB</b>). All on-chain BEP-20 transfers are BLOCKED because network gas cannot be paid! Please deposit BNB immediately.` 
  : `⚠️ <b>LOW GAS:</b> BNB balance is low (<b>${walletInfo.bnbBalance} BNB</b>). Payouts may fail if gas runs out completely. Please top up BNB for network transaction fees.`}
━━━━━━━━━━━━━━━━━━━━
🔗 <a href="${walletInfo.bscScanUrl}">View Payout Wallet on BscScan</a>`;

        await this.bot.api.sendMessage({
          chat_id: destChatId,
          text: bnbAlertMsg,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 View on BscScan', url: walletInfo.bscScanUrl }],
              [{ text: '🔄 Refresh Status', callback_data: 'cmd_dashboard' }]
            ]
          }
        }).catch((e) => console.warn('Could not send BNB gas alert:', e.message));
      }
    } else {
      this.lastBnbAlertState = 'ok';
    }
  }

  /**
   * Run background check for wallet balances and risk thresholds
   */
  async runPeriodicWalletHealthCheck() {
    try {
      const walletInfo = await payoutService.getWalletInfo();
      if (walletInfo.configured) {
        await this.checkAndSendWalletRiskAlerts(walletInfo);
      }
    } catch (e) {
      console.warn('runPeriodicWalletHealthCheck warning:', e.message);
    }
  }

  /**
   * Send Pending Withdrawals List to Admin
   */
  async sendPendingWithdrawalsMessage(chatId) {
    if (!this.bot) return;

    try {
      const txRes = await dbService.getTransactions(null, 10);
      const pendingTxs = (txRes || []).filter(t => t.status === 'Pending');

      if (pendingTxs.length === 0 && this.pendingWithdrawals.size === 0) {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: `✅ <b>No Pending Withdrawals!</b>\nAll user withdrawal requests have been processed and paid out.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Refresh Dashboard', callback_data: 'cmd_dashboard' }]
            ]
          }
        });
        return;
      }

      let msg = `📋 <b>PENDING WITHDRAWAL REQUESTS (${pendingTxs.length}):</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      pendingTxs.forEach((tx, idx) => {
        msg += `${idx + 1}. 🆔 <code>${tx.id}</code>\n   👤 User: <code>${tx.userId}</code> | 💰 <b>${tx.amount}</b>\n   📍 To: <code>${tx.recipientAddress || 'N/A'}</code>\n\n`;
      });
      msg += `<i>Use the inline action cards above or click Approve & Pay to process.</i>`;

      await this.bot.api.sendMessage({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Refresh Dashboard', callback_data: 'cmd_dashboard' }]
          ]
        }
      });
    } catch (err) {
      console.error('Error in sendPendingWithdrawalsMessage:', err);
    }
  }

  async sendBalanceMessage(chatId) {
    if (!this.bot) return;
    const walletInfo = await payoutService.getWalletInfo();

    if (walletInfo.configured) {
      const usdtVal = parseFloat(walletInfo.usdtBalance || 0);
      const bnbVal = parseFloat(walletInfo.bnbBalance || 0);

      const usdtStatus = usdtVal <= 5.0 ? `⚠️ Low (< $5.00)` : `🟢 Healthy`;
      const bnbStatus = bnbVal < 0.003 ? `⚠️ Low Gas` : `🟢 Sufficient`;

      const msg = `💼 <b>Payout Hot Wallet (BEP-20)</b>
━━━━━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>${walletInfo.address}</code>
💎 <b>USDT Balance:</b> <code>${walletInfo.usdtBalance} USDT</code> [${usdtStatus}]
⛽ <b>BNB Gas Balance:</b> <code>${walletInfo.bnbBalance} BNB</code> [${bnbStatus}]
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
            [{ text: '🔄 Refresh Dashboard', callback_data: 'cmd_dashboard' }]
          ]
        }
      });

      this.checkAndSendWalletRiskAlerts(walletInfo, chatId).catch(() => {});
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
   * Send Clean & Detailed Withdrawal Request to Admin Telegram
   */
  async notifyWithdrawalRequest(withdrawalData) {
    const {
      txId,
      userId,
      username,
      name,
      amount,
      fee,
      finalReceived,
      address,
      network,
      mainBalance,
      depositBalance,
      totalBalance,
      totalWithdrawn,
      totalDeposited,
      totalReferrals,
      activeMinersCount,
      minerName,
      miningRate
    } = withdrawalData;

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
    const computedTotalBal = totalBalance !== undefined ? parseFloat(totalBalance).toFixed(4) : (parseFloat(mainBalance || 0) + parseFloat(depositBalance || 0)).toFixed(4);

    const alertMessage = `🚨 <b>NEW WITHDRAWAL REQUEST</b> 🚨
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Tx ID:</b> <code>${txId}</code>
👤 <b>User:</b> @${username || 'Anonymous'} (UID: <code>${userId}</code>)
📛 <b>Name:</b> ${name || 'Alex Miner'}
━━━━━━━━━━━━━━━━━━━━
💰 <b>USER BALANCE & PROFILE:</b>
• 💎 <b>Main (Withdrawable):</b> <code>${parseFloat(mainBalance || 0).toFixed(4)} USDT</code>
• 🛍️ <b>NFT / Deposit Bal:</b> <code>${parseFloat(depositBalance || 0).toFixed(2)} USDT</code>
• 💵 <b>Total User Balance:</b> <code>${computedTotalBal} USDT</code>
• 📤 <b>Total Withdrawn:</b> <code>${parseFloat(totalWithdrawn || 0).toFixed(4)} USDT</code>
• 📈 <b>Total Deposited:</b> <code>+${parseFloat(totalDeposited || 0).toFixed(2)} USDT</code>
━━━━━━━━━━━━━━━━━━━━
📊 <b>USER ACTIVITY & STATS:</b>
• 👥 <b>Total Referrals:</b> <b>${totalReferrals || 0} Users</b>
• 🤖 <b>Active Miners:</b> <b>${activeMinersCount || 1} Active</b> (<code>${minerName || 'Cyber Bot #1024'}</code>)
• ⚡ <b>Daily Mining Rate:</b> <code>${parseFloat(miningRate || 0.0200).toFixed(4)} USDT/day</code>
━━━━━━━━━━━━━━━━━━━━
💵 <b>WITHDRAWAL SPECIFICS:</b>
• 💵 <b>Requested Amount:</b> <code>${amount.toFixed(4)} USDT</code>
• ⛽ <b>Network Fee:</b> <code>${fee.toFixed(4)} USDT</code>
• 💎 <b>Net to Send:</b> <code>${finalReceived.toFixed(4)} USDT</code>
• 🌐 <b>Network:</b> ${network || 'USDT BEP-20 (BNB Smart Chain)'}
• 📍 <b>Destination Wallet:</b>
<code>${address}</code>
• ⏰ <b>Time:</b> ${nowUtc}
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

  /**
   * Broadcast Confirmed Withdrawal to Public Proof Channel (@cryptomintwithdraw)
   */
  async broadcastWithdrawalToProofChannel(data) {
    const channelId = process.env.PAYOUT_PROOF_CHANNEL || '@cryptomintwithdraw';
    const {
      username,
      amount,
      fromAddress,
      toAddress,
      txHash,
      bscScanUrl
    } = data;

    const rawUser = username ? String(username).replace(/^@/, '') : 'Miner';
    const cleanUsername = `@${rawUser}`;
    const formattedAmount = parseFloat(amount || 0).toFixed(4);

    const formatShort = (addr) => {
      if (!addr) return '0x0000...0000';
      const str = String(addr).trim();
      if (str.length <= 12) return str;
      return `${str.substring(0, 6)}...${str.substring(str.length - 4)}`;
    };

    const fromShort = formatShort(fromAddress || '0x9cccFDFfa030A90bEBd73c7dB610B5E05Eb8Bd040a6');
    const toShort = formatShort(toAddress);
    const cleanBscUrl = bscScanUrl || `https://bscscan.com/tx/${txHash}`;

    const timeStr = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const botUsername = (process.env.BOT_USERNAME || 'cryptomintnftbot').replace(/^@/, '');

    const channelMessage = `🚀 <b>New Withdrawal Confirmed! (BSC Network)</b>

🌐 <b>Username:</b> ${cleanUsername}
💰 <b>Amount:</b> ${formattedAmount} USDT
📤 <b>From:</b> <code>${fromShort}</code>
📥 <b>To:</b> <code>${toShort}</code>
🌐 <b>Network:</b> Binance Smart Chain (BEP-20)
🕒 <b>Time:</b> ${timeStr}
🤖 <b>Bot:</b> @${botUsername}

🔗 <a href="${cleanBscUrl}">View on BscScan</a>`;

    const msgPayload = {
      chat_id: channelId,
      text: channelMessage,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔍 View on BscScan', url: cleanBscUrl }
          ]
        ]
      }
    };

    let sent = null;

    // 1. Try Main Bot (@cryptomintnftbot)
    try {
      const mainBotService = require('./mainBotService');
      if (mainBotService?.bot) {
        sent = await mainBotService.bot.api.sendMessage(msgPayload);
        console.log(`📢 [Main Bot] Broadcasted confirmed withdrawal to ${channelId} successfully!`);
        return sent;
      }
    } catch (e) {
      console.warn(`[Main Bot] Broadcast attempt note: ${e.message}`);
    }

    // 2. Fallback to Admin Bot (@acryptomintadminwithdraw2bot)
    if (!sent && this.bot) {
      try {
        sent = await this.bot.api.sendMessage(msgPayload);
        console.log(`📢 [Admin Bot] Broadcasted confirmed withdrawal to ${channelId} successfully!`);
        return sent;
      } catch (err) {
        console.error(`❌ Both bots failed to post to ${channelId}:`, err.message);
        throw err;
      }
    }

    return sent;
  }

  /**
   * Send real-time multi-account alert to Admin (@ownerof421)
   */
  async notifyMultiAccountAbuse(info) {
    const adminId = this.adminChatId || process.env.ADMIN_CHAT_ID;
    if (!adminId || !this.bot) return;

    try {
      const text = `🚨 <b>MULTI-ACCOUNT ABUSE DETECTED & AUTO-BANNED!</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Offending UID:</b> <code>${info.userId}</code> (@${info.username || 'unknown'})
🔗 <b>Matched User:</b> <code>${info.matchedUserId || 'N/A'}</code> (@${info.matchedUsername || 'unknown'})
📱 <b>Device FP:</b> <code>${(info.deviceFp || 'N/A').slice(0, 24)}...</code>
🌐 <b>IP Address:</b> <code>${info.ip || 'N/A'}</code>
⚠️ <b>Reason:</b> <i>${info.reason || 'Multiple accounts from same device/IP'}</i>
━━━━━━━━━━━━━━━━━━━━
🔒 <i>New account has been automatically suspended and referral rewards cancelled.</i>`;

      await this.bot.api.sendMessage({
        chat_id: adminId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👤 Offender Info', callback_data: `ban:${info.userId}` }],
            [{ text: '🔄 Admin Dashboard', callback_data: 'cmd_dashboard' }]
          ]
        }
      });
    } catch (err) {
      console.warn('notifyMultiAccountAbuse error:', err.message);
    }
  }
}

module.exports = new TelegramBotService();
