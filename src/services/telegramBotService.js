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
    this.adminSessions = new Map(); // Session state for interactive admin inputs
  }

  init() {
    const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token.trim() === '' || token.includes('YOUR_BOT_TOKEN')) {
      console.warn('⚠️ Admin Telegram Bot Token is not set in environment. Bot notifications will be skipped.');
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

      // Preload pending withdrawals from DB
      this.loadPendingWithdrawalsFromDB().catch(() => {});

      // Start periodic background wallet health & gas fee monitor (every 10 mins)
      if (this.monitorInterval) clearInterval(this.monitorInterval);
      this.monitorInterval = setInterval(() => {
        this.runPeriodicWalletHealthCheck().catch(() => {});
      }, 10 * 60 * 1000);

    } catch (err) {
      console.error('❌ Failed to initialize Telegram Bot:', err.message);
    }
  }

  /**
   * Preload any pending withdrawal requests from Neon PostgreSQL into memory
   */
  async loadPendingWithdrawalsFromDB() {
    try {
      const pendingTxs = await dbService.getPendingWithdrawals(100);
      for (const tx of pendingTxs) {
        const user = await dbService.getUser(tx.userId).catch(() => null);
        const numAmount = Math.abs(parseFloat(String(tx.amount).replace(/[^0-9.]/g, '')) || 0);
        const isBep20 = (tx.network || '').toUpperCase().includes('BEP20') || (tx.type || '').toUpperCase().includes('BEP20');
        const fee = isBep20 ? 0.0050 : 1.0;
        const finalReceived = parseFloat(Math.max(0, numAmount - fee).toFixed(4));

        this.pendingWithdrawals.set(tx.id, {
          txId: tx.id,
          userId: tx.userId,
          username: user?.username || 'Anonymous',
          name: user?.name || user?.firstName || 'Miner',
          amount: numAmount,
          fee: fee,
          finalReceived: finalReceived,
          address: tx.recipientAddress,
          network: tx.network || 'USDT BEP-20',
          status: tx.status || 'Pending',
          createdAt: tx.createdAt || new Date()
        });
      }
      if (pendingTxs.length > 0) {
        console.log(`📥 [Admin Bot] Preloaded ${pendingTxs.length} pending withdrawals from database into memory.`);
      }
    } catch (err) {
      console.warn('⚠️ [Admin Bot] Could not preload pending withdrawals from DB:', err.message);
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
          allowedUpdates: ['message', 'callback_query'],
          retry: true,
          retryDelayMs: 3000
        });
      } catch (err) {
        const isConflict = String(err.message || '').includes('409');
        const delayMs = isConflict ? 10000 : 4000;
        console.warn(`⚠️ [Admin Bot] Polling notice: ${err.message || err} — Reconnecting in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
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

    // /user or /search or /find command
    const handleUserSearchCommand = async (ctx) => {
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

        if (parts.length > 1 && parts[1].trim()) {
          const query = parts.slice(1).join(' ').trim();
          const found = await dbService.searchUser(query);
          if (found) {
            await this.sendUserProfileCard(chatId, found.telegramId);
          } else {
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `⚠️ <b>User Not Found:</b> No user matched "<code>${this.escapeHtml(query)}</code>".\nPlease verify the UID or @username and try again.`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔍 Search Again', callback_data: 'cmd_search_user' }],
                  [{ text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }]
                ]
              }
            });
          }
        } else {
          // Prompt for query
          this.adminSessions.set(chatId, { state: 'AWAITING_SEARCH_QUERY' });
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `🔍 <b>USER SEARCH:</b>\n━━━━━━━━━━━━━━━━━━━━\nPlease send the <b>Telegram UID</b> (e.g. <code>9482103</code>) or <b>@Username</b> (e.g. <code>@alex_miner</code>) or <b>Referral Code</b>:\n\n<i>(Or send /cancel to abort)</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancel Search', callback_data: 'cmd_dashboard' }]
              ]
            }
          });
        }
      } catch (err) {
        console.error('Error handling /user search:', err.message);
      }
    };

    this.bot.command('user', handleUserSearchCommand);
    this.bot.command('search', handleUserSearchCommand);
    this.bot.command('find', handleUserSearchCommand);

    // /addbalance command: /addbalance <UID> <amount>
    const handleAddBalanceCommand = async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) return;
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];
        const amount = parseFloat(parts[2]);

        if (!targetId || isNaN(targetId) || isNaN(amount) || amount <= 0) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `⚠️ <b>Usage:</b> <code>/addbalance &lt;UID&gt; &lt;amount&gt;</code>\nExample: <code>/addbalance 9482103 10</code> (adds 10 USDT to withdrawable balance)`,
            parse_mode: 'HTML'
          });
          return;
        }

        const updated = await dbService.adminAdjustBalance(targetId, {
          type: 'withdrawable',
          amount,
          adminUsername: ctx.from?.username || 'ownerof421',
          reason: 'Admin Manual Credit'
        });

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: `✅ <b>BALANCE CREDITED SUCCESSFULLY!</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>User:</b> @${this.escapeHtml(updated.username)} (UID: <code>${updated.telegramId}</code>)\n💎 <b>Added Amount:</b> <code>+${amount.toFixed(4)} USDT</code> (Withdrawable)\n💰 <b>New Total Balance:</b> <code>${updated.balance.toFixed(4)} USDT</code>`,
          parse_mode: 'HTML'
        });

        await this.sendUserProfileCard(chatId, targetId);
      } catch (err) {
        console.error('Error handling /addbalance:', err.message);
        if (ctx.chatId) {
          await this.bot.api.sendMessage({
            chat_id: ctx.chatId,
            text: `❌ <b>Error:</b> <code>${this.escapeHtml(err.message)}</code>`,
            parse_mode: 'HTML'
          });
        }
      }
    };

    this.bot.command('addbalance', handleAddBalanceCommand);
    this.bot.command('addbal', handleAddBalanceCommand);

    // /adddeposit command: /adddeposit <UID> <amount>
    const handleAddDepositCommand = async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) return;
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];
        const amount = parseFloat(parts[2]);

        if (!targetId || isNaN(targetId) || isNaN(amount) || amount <= 0) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `⚠️ <b>Usage:</b> <code>/adddeposit &lt;UID&gt; &lt;amount&gt;</code>\nExample: <code>/adddeposit 9482103 50</code> (adds 50 USDT to NFT/deposit balance)`,
            parse_mode: 'HTML'
          });
          return;
        }

        const updated = await dbService.adminAdjustBalance(targetId, {
          type: 'deposit',
          amount,
          adminUsername: ctx.from?.username || 'ownerof421',
          reason: 'Admin Deposit Credit'
        });

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: `✅ <b>DEPOSIT BALANCE CREDITED!</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>User:</b> @${this.escapeHtml(updated.username)} (UID: <code>${updated.telegramId}</code>)\n🛍️ <b>Added Amount:</b> <code>+${amount.toFixed(2)} USDT</code> (Deposit/NFT)\n💰 <b>New Deposit Balance:</b> <code>${updated.depositBalance.toFixed(2)} USDT</code>`,
          parse_mode: 'HTML'
        });

        await this.sendUserProfileCard(chatId, targetId);
      } catch (err) {
        console.error('Error handling /adddeposit:', err.message);
      }
    };

    this.bot.command('adddeposit', handleAddDepositCommand);
    this.bot.command('adddep', handleAddDepositCommand);

    // /deductbalance command: /deductbalance <UID> <amount>
    const handleDeductBalanceCommand = async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) return;
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];
        const amount = parseFloat(parts[2]);

        if (!targetId || isNaN(targetId) || isNaN(amount) || amount <= 0) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `⚠️ <b>Usage:</b> <code>/deductbalance &lt;UID&gt; &lt;amount&gt;</code>\nExample: <code>/deductbalance 9482103 5</code> (deducts 5 USDT from balance)`,
            parse_mode: 'HTML'
          });
          return;
        }

        const updated = await dbService.adminAdjustBalance(targetId, {
          type: 'deduct',
          amount,
          adminUsername: ctx.from?.username || 'ownerof421',
          reason: 'Admin Balance Deduction'
        });

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: `✅ <b>BALANCE DEDUCTED!</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>User:</b> @${this.escapeHtml(updated.username)} (UID: <code>${updated.telegramId}</code>)\n➖ <b>Deducted:</b> <code>-${amount.toFixed(4)} USDT</code>\n💎 <b>Remaining Balance:</b> <code>${updated.balance.toFixed(4)} USDT</code>`,
          parse_mode: 'HTML'
        });

        await this.sendUserProfileCard(chatId, targetId);
      } catch (err) {
        console.error('Error handling /deductbalance:', err.message);
      }
    };

    this.bot.command('deductbalance', handleDeductBalanceCommand);
    this.bot.command('deductbal', handleDeductBalanceCommand);

    // /setlimit command: /setlimit <UID> <count or default>
    const handleSetLimitCommand = async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        if (!this.isAuthorizedAdmin(ctx.from)) return;
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        const targetId = parts[1];
        const limitArg = parts[2];

        if (!targetId || isNaN(targetId) || !limitArg) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `⚠️ <b>Usage:</b> <code>/setlimit &lt;UID&gt; &lt;limit_count or default&gt;</code>\nExamples:\n• <code>/setlimit 9482103 3</code> (sets daily limit to 3 times/day)\n• <code>/setlimit 9482103 5</code> (sets daily limit to 5 times/day)\n• <code>/setlimit 9482103 default</code> (resets to standard system default)`,
            parse_mode: 'HTML'
          });
          return;
        }

        const isReset = limitArg.toLowerCase() === 'default' || limitArg.toLowerCase() === 'reset';
        const numLimit = isReset ? null : parseInt(limitArg, 10);

        if (!isReset && (isNaN(numLimit) || numLimit < 0)) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `❌ <b>Invalid Limit!</b> Please enter a valid integer count (e.g. <code>3</code>, <code>5</code>, <code>10</code>) or <code>default</code>.`,
            parse_mode: 'HTML'
          });
          return;
        }

        const updated = await dbService.setUserDailyWithdrawLimit(targetId, numLimit);
        if (!updated) {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `⚠️ User with ID <code>${targetId}</code> not found in database.`,
            parse_mode: 'HTML'
          });
          return;
        }

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: isReset
            ? `✅ <b>WITHDRAWAL LIMIT RESET!</b>\nDaily limit for @${this.escapeHtml(updated.username)} (UID: <code>${targetId}</code>) has been reset to system default.`
            : `✅ <b>DAILY WITHDRAWAL LIMIT UPDATED!</b>\nTarget User: @${this.escapeHtml(updated.username)} (UID: <code>${targetId}</code>)\n⏱️ New Daily Limit: <b>${numLimit} times/day</b>`,
          parse_mode: 'HTML'
        });

        await this.sendUserProfileCard(chatId, targetId);
      } catch (err) {
        console.error('Error handling /setlimit:', err.message);
      }
    };

    this.bot.command('setlimit', handleSetLimitCommand);
    this.bot.command('limit', handleSetLimitCommand);
    this.bot.command('withdrawlimit', handleSetLimitCommand);

    // /cancel command
    this.bot.command('cancel', async (ctx) => {
      const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
      if (chatId) {
        this.adminSessions.delete(chatId);
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: '✅ <b>Operation cancelled.</b>',
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }]
            ]
          }
        });
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
        const helpMsg = `📖 <b>Admin Bot Master Guide & Commands:</b>
━━━━━━━━━━━━━━━━━━━━
1. 🛡️ <b>/start & /admin:</b> Live Master Admin Dashboard with all system metrics, balances, deposits, approved/pending withdrawals, and wallet gas status.
2. 🔍 <b>/user &lt;UID or @username&gt;:</b> Search user details, view complete audit card, active miner, referral list & transaction history.
3. ➕ <b>/addbalance &lt;UID&gt; &lt;amount&gt;:</b> Add Withdrawable USDT balance directly to user account.
4. 🛍️ <b>/adddeposit &lt;UID&gt; &lt;amount&gt;:</b> Add Deposit / NFT Purchase USDT balance to user.
5. ➖ <b>/deductbalance &lt;UID&gt; &lt;amount&gt;:</b> Deduct Withdrawable USDT balance from user.
6. ⏱️ <b>/setlimit &lt;UID&gt; &lt;count or default&gt;:</b> Set custom daily withdrawal count limit (e.g. 1, 3, 5, 10 times/day).
7. 🚫 <b>/ban &lt;UID&gt; & /unban &lt;UID&gt;:</b> Block or unblock any user account.
8. 📥 <b>Withdrawal Approval:</b> When a user requests withdrawal, you get an instant card with <b>[Approve & Pay]</b> and <b>[Reject]</b>.
9. 💸 <b>On-Chain Auto Payout:</b> Instant BEP20 USDT payout, auto-broadcasted to @cryptomintwithdraw.
10. 🚨 <b>Risk Alerts:</b> Automated notification when Master Wallet USDT balance drops <= $5 or when BNB gas is low/exhausted.`;

        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: helpMsg,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.error('Error handling /help:', err.message);
      }
    });

    // Message handler for raw text commands and interactive input sessions
    this.bot.on('message:text', async (ctx) => {
      try {
        const chatId = ctx.chatId || ctx.chat?.id || ctx.from?.id;
        const text = (ctx.message?.text || '').trim();
        if (!chatId || !text) return;

        // Strict authorization check
        if (!this.isAuthorizedAdmin(ctx.from)) return;

        // Check if dashboard command
        if (text === '/start' || text.startsWith('/start') || text === '/admin' || text === '/dashboard' || text === '/stats') {
          this.adminSessions.delete(chatId);
          await handleDashboard(ctx);
          return;
        }

        // Cancel command
        if (text === '/cancel' || text.toLowerCase() === 'cancel') {
          this.adminSessions.delete(chatId);
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: '✅ <b>Operation cancelled.</b>',
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }]
              ]
            }
          });
          return;
        }

        // Check if there is an active interactive session
        const session = this.adminSessions.get(chatId);
        if (session) {
          if (session.state === 'AWAITING_SEARCH_QUERY') {
            this.adminSessions.delete(chatId);
            const found = await dbService.searchUser(text);
            if (found) {
              await this.sendUserProfileCard(chatId, found.telegramId);
            } else {
              await this.bot.api.sendMessage({
                chat_id: chatId,
                text: `⚠️ <b>User Not Found:</b> No user matched "<code>${this.escapeHtml(text)}</code>".\nPlease verify the UID or @username and try again.`,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔍 Search Again', callback_data: 'cmd_search_user' }],
                    [{ text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }]
                  ]
                }
              });
            }
            return;
          }

          if (session.state === 'AWAITING_CUSTOM_ADD_BALANCE') {
            const targetId = session.targetUserId;
            this.adminSessions.delete(chatId);
            const amt = parseFloat(text);
            if (isNaN(amt) || amt <= 0) {
              await this.bot.api.sendMessage({
                chat_id: chatId,
                text: `❌ <b>Invalid Amount!</b> Please enter a valid positive number (e.g. <code>10.5</code>).`,
                parse_mode: 'HTML'
              });
              return;
            }

            const updated = await dbService.adminAdjustBalance(targetId, {
              type: 'withdrawable',
              amount: amt,
              adminUsername: ctx.from?.username || 'ownerof421',
              reason: 'Admin Custom Credit'
            });

            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>BALANCE CREDITED!</b>\nAdded <code>+${amt.toFixed(4)} USDT</code> (Withdrawable) to @${this.escapeHtml(updated.username)} (UID: <code>${targetId}</code>). New balance: <code>${updated.balance.toFixed(4)} USDT</code>`,
              parse_mode: 'HTML'
            });

            await this.sendUserProfileCard(chatId, targetId);
            return;
          }

          if (session.state === 'AWAITING_CUSTOM_ADD_DEPOSIT') {
            const targetId = session.targetUserId;
            this.adminSessions.delete(chatId);
            const amt = parseFloat(text);
            if (isNaN(amt) || amt <= 0) {
              await this.bot.api.sendMessage({
                chat_id: chatId,
                text: `❌ <b>Invalid Amount!</b> Please enter a valid positive number (e.g. <code>50</code>).`,
                parse_mode: 'HTML'
              });
              return;
            }

            const updated = await dbService.adminAdjustBalance(targetId, {
              type: 'deposit',
              amount: amt,
              adminUsername: ctx.from?.username || 'ownerof421',
              reason: 'Admin Custom Deposit Credit'
            });

            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>DEPOSIT BALANCE CREDITED!</b>\nAdded <code>+${amt.toFixed(2)} USDT</code> (Deposit/NFT) to @${this.escapeHtml(updated.username)} (UID: <code>${targetId}</code>). New deposit balance: <code>${updated.depositBalance.toFixed(2)} USDT</code>`,
              parse_mode: 'HTML'
            });

            await this.sendUserProfileCard(chatId, targetId);
            return;
          }

          if (session.state === 'AWAITING_CUSTOM_DEDUCT_BALANCE') {
            const targetId = session.targetUserId;
            this.adminSessions.delete(chatId);
            const amt = parseFloat(text);
            if (isNaN(amt) || amt <= 0) {
              await this.bot.api.sendMessage({
                chat_id: chatId,
                text: `❌ <b>Invalid Amount!</b> Please enter a valid positive number (e.g. <code>5.0</code>).`,
                parse_mode: 'HTML'
              });
              return;
            }

            const updated = await dbService.adminAdjustBalance(targetId, {
              type: 'deduct',
              amount: amt,
              adminUsername: ctx.from?.username || 'ownerof421',
              reason: 'Admin Custom Deduction'
            });

            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>BALANCE DEDUCTED!</b>\nDeducted <code>-${amt.toFixed(4)} USDT</code> from @${this.escapeHtml(updated.username)} (UID: <code>${targetId}</code>). Remaining balance: <code>${updated.balance.toFixed(4)} USDT</code>`,
              parse_mode: 'HTML'
            });

            await this.sendUserProfileCard(chatId, targetId);
            return;
          }

          if (session.state === 'AWAITING_CUSTOM_WITHDRAW_LIMIT') {
            const targetId = session.targetUserId;
            this.adminSessions.delete(chatId);
            const isReset = text.toLowerCase() === 'default' || text.toLowerCase() === 'reset';
            const numLimit = isReset ? null : parseInt(text, 10);

            if (!isReset && (isNaN(numLimit) || numLimit < 0)) {
              await this.bot.api.sendMessage({
                chat_id: chatId,
                text: `❌ <b>Invalid Limit!</b> Please enter a valid positive integer count (e.g. <code>3</code>, <code>5</code>, <code>10</code>) or <code>default</code>.`,
                parse_mode: 'HTML'
              });
              return;
            }

            const updated = await dbService.setUserDailyWithdrawLimit(targetId, numLimit);
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: isReset
                ? `✅ <b>WITHDRAWAL LIMIT RESET:</b> Daily limit for @${this.escapeHtml(updated?.username || targetId)} has been reset to system default.`
                : `✅ <b>DAILY LIMIT SET:</b> Set to <b>${numLimit} times/day</b> for @${this.escapeHtml(updated?.username || targetId)} (UID: <code>${targetId}</code>)!`,
              parse_mode: 'HTML'
            });

            await this.sendUserProfileCard(chatId, targetId);
            return;
          }
        }

        // If no active session and text is not a command starting with /, check if it's a numeric UID or @username
        if (!text.startsWith('/')) {
          const isNumeric = /^\d{4,15}$/.test(text);
          const isUsername = /^@?[a-zA-Z0-9_]{3,32}$/.test(text);
          const isRefCode = /^(REF|ref|CRYPTO|crypto)-/i.test(text);

          if (isNumeric || isUsername || isRefCode) {
            const found = await dbService.searchUser(text);
            if (found) {
              await this.sendUserProfileCard(chatId, found.telegramId);
              return;
            }
          }
        }
      } catch (err) {
        console.error('Error handling message:text:', err.message);
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
          this.adminSessions.delete(chatId);
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

        if (data === 'cmd_search_user') {
          this.adminSessions.set(chatId, { state: 'AWAITING_SEARCH_QUERY' });
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `🔍 <b>USER SEARCH:</b>\n━━━━━━━━━━━━━━━━━━━━\nPlease send the <b>Telegram UID</b> (e.g. <code>9482103</code>) or <b>@Username</b> (e.g. <code>@alex_miner</code>) or <b>Referral Code</b>:\n\n<i>(Or send /cancel to abort)</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancel Search', callback_data: 'cmd_dashboard' }]
              ]
            }
          });
          return;
        }

        if (data.startsWith('user_view:')) {
          const targetId = data.split(':')[1];
          await this.sendUserProfileCard(chatId, targetId, messageId);
          return;
        }

        if (data.startsWith('user_refresh:')) {
          const targetId = data.split(':')[1];
          await this.sendUserProfileCard(chatId, targetId, messageId);
          return;
        }

        if (data.startsWith('user_addbal_menu:')) {
          const targetId = data.split(':')[1];
          await this.sendAddBalanceMenu(chatId, targetId, 'withdrawable', messageId);
          return;
        }

        if (data.startsWith('user_adddep_menu:')) {
          const targetId = data.split(':')[1];
          await this.sendAddBalanceMenu(chatId, targetId, 'deposit', messageId);
          return;
        }

        if (data.startsWith('user_deduct_menu:')) {
          const targetId = data.split(':')[1];
          await this.sendAddBalanceMenu(chatId, targetId, 'deduct', messageId);
          return;
        }

        if (data.startsWith('user_txs:')) {
          const targetId = data.split(':')[1];
          await this.sendUserTransactions(chatId, targetId, messageId);
          return;
        }

        if (data.startsWith('user_refs:')) {
          const targetId = data.split(':')[1];
          await this.sendUserReferrals(chatId, targetId, messageId);
          return;
        }

        if (data.startsWith('user_limit_menu:')) {
          const targetId = data.split(':')[1];
          await this.sendWithdrawLimitMenu(chatId, targetId, messageId);
          return;
        }

        if (data.startsWith('user_prompt_custom_limit:')) {
          const targetId = data.split(':')[1];
          this.adminSessions.set(chatId, { state: 'AWAITING_CUSTOM_WITHDRAW_LIMIT', targetUserId: targetId });
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `✏️ <b>Enter Custom Daily Withdrawal Limit:</b>\n━━━━━━━━━━━━━━━━━━━━\nTarget UID: <code>${targetId}</code>\n\n<i>Type a number (e.g. <code>3</code>, <code>5</code>, <code>10</code>) or type <code>default</code> to reset:</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to User Profile', callback_data: `user_view:${targetId}` }]
              ]
            }
          });
          return;
        }

        if (data.startsWith('user_exec_limit:')) {
          const [, targetId, limitStr] = data.split(':');
          const numLimit = parseInt(limitStr, 10);
          if (targetId && !isNaN(numLimit) && numLimit >= 0) {
            const updated = await dbService.setUserDailyWithdrawLimit(targetId, numLimit);
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>Daily Limit Set to ${numLimit} times/day</b> for @${this.escapeHtml(updated?.username || targetId)}!`,
              parse_mode: 'HTML'
            });
            await this.sendUserProfileCard(chatId, targetId, messageId);
          }
          return;
        }

        if (data.startsWith('user_reset_limit:')) {
          const targetId = data.split(':')[1];
          if (targetId) {
            const updated = await dbService.setUserDailyWithdrawLimit(targetId, null);
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>Daily Limit Reset to Default</b> for @${this.escapeHtml(updated?.username || targetId)}!`,
              parse_mode: 'HTML'
            });
            await this.sendUserProfileCard(chatId, targetId, messageId);
          }
          return;
        }

        if (data.startsWith('user_prompt_custom_bal:')) {
          const targetId = data.split(':')[1];
          this.adminSessions.set(chatId, { state: 'AWAITING_CUSTOM_ADD_BALANCE', targetUserId: targetId });
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `✏️ <b>Enter Custom Amount to Add (Withdrawable Balance):</b>\n━━━━━━━━━━━━━━━━━━━━\nTarget UID: <code>${targetId}</code>\n\n<i>Type the number (e.g. <code>25.5</code>) and send:</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to User Profile', callback_data: `user_view:${targetId}` }]
              ]
            }
          });
          return;
        }

        if (data.startsWith('user_prompt_custom_dep:')) {
          const targetId = data.split(':')[1];
          this.adminSessions.set(chatId, { state: 'AWAITING_CUSTOM_ADD_DEPOSIT', targetUserId: targetId });
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `✏️ <b>Enter Custom Amount to Add (Deposit / NFT Balance):</b>\n━━━━━━━━━━━━━━━━━━━━\nTarget UID: <code>${targetId}</code>\n\n<i>Type the number (e.g. <code>50</code>) and send:</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to User Profile', callback_data: `user_view:${targetId}` }]
              ]
            }
          });
          return;
        }

        if (data.startsWith('user_prompt_custom_deduct:')) {
          const targetId = data.split(':')[1];
          this.adminSessions.set(chatId, { state: 'AWAITING_CUSTOM_DEDUCT_BALANCE', targetUserId: targetId });
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: `✏️ <b>Enter Custom Amount to Deduct:</b>\n━━━━━━━━━━━━━━━━━━━━\nTarget UID: <code>${targetId}</code>\n\n<i>Type the number (e.g. <code>5.0</code>) and send:</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to User Profile', callback_data: `user_view:${targetId}` }]
              ]
            }
          });
          return;
        }

        if (data.startsWith('user_exec_addbal:')) {
          const [, targetId, amtStr] = data.split(':');
          const amt = parseFloat(amtStr);
          if (targetId && !isNaN(amt) && amt > 0) {
            await dbService.adminAdjustBalance(targetId, {
              type: 'withdrawable',
              amount: amt,
              adminUsername: from?.username || 'ownerof421',
              reason: 'Admin Preset Quick Credit'
            });
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>Added +${amt.toFixed(4)} USDT</b> (Withdrawable) to UID <code>${targetId}</code>!`,
              parse_mode: 'HTML'
            });
            await this.sendUserProfileCard(chatId, targetId, messageId);
          }
          return;
        }

        if (data.startsWith('user_exec_adddep:')) {
          const [, targetId, amtStr] = data.split(':');
          const amt = parseFloat(amtStr);
          if (targetId && !isNaN(amt) && amt > 0) {
            await dbService.adminAdjustBalance(targetId, {
              type: 'deposit',
              amount: amt,
              adminUsername: from?.username || 'ownerof421',
              reason: 'Admin Deposit Quick Credit'
            });
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>Added +${amt.toFixed(2)} USDT</b> (Deposit/NFT) to UID <code>${targetId}</code>!`,
              parse_mode: 'HTML'
            });
            await this.sendUserProfileCard(chatId, targetId, messageId);
          }
          return;
        }

        if (data.startsWith('user_exec_deduct:')) {
          const [, targetId, amtStr] = data.split(':');
          const amt = parseFloat(amtStr);
          if (targetId && !isNaN(amt) && amt > 0) {
            await dbService.adminAdjustBalance(targetId, {
              type: 'deduct',
              amount: amt,
              adminUsername: from?.username || 'ownerof421',
              reason: 'Admin Balance Quick Deduction'
            });
            await this.bot.api.sendMessage({
              chat_id: chatId,
              text: `✅ <b>Deducted -${amt.toFixed(4)} USDT</b> from UID <code>${targetId}</code>!`,
              parse_mode: 'HTML'
            });
            await this.sendUserProfileCard(chatId, targetId, messageId);
          }
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
                [{ text: '✅ Unban Account', callback_data: `unban:${targetId}` }],
                [{ text: '👤 View Profile', callback_data: `user_view:${targetId}` }]
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
                [{ text: '🚫 Ban Account', callback_data: `ban:${targetId}` }],
                [{ text: '👤 View Profile', callback_data: `user_view:${targetId}` }]
              ]
            }
          });
          return;
        }

        // --- WITHDRAWAL APPROVAL & REJECTION ACTIONS ---
        const txId = targetId;
        let withdrawal = this.pendingWithdrawals.get(txId);

        // Persistent Fallback: If not in memory (e.g. after redeploy/restart), load directly from PostgreSQL!
        if (!withdrawal) {
          const dbTx = await dbService.getTransaction(txId);
          if (dbTx) {
            const user = await dbService.getUser(dbTx.userId).catch(() => null);
            const numAmount = Math.abs(parseFloat(String(dbTx.amount).replace(/[^0-9.]/g, '')) || 0);
            const isBep20 = (dbTx.network || '').toUpperCase().includes('BEP20') || (dbTx.type || '').toUpperCase().includes('BEP20');
            const fee = isBep20 ? 0.0050 : 1.0;
            const finalReceived = parseFloat(Math.max(0, numAmount - fee).toFixed(4));

            withdrawal = {
              txId: dbTx.id,
              userId: dbTx.userId,
              username: user?.username || 'Anonymous',
              name: user?.name || user?.firstName || 'Miner',
              amount: numAmount,
              fee: fee,
              finalReceived: finalReceived,
              address: dbTx.recipientAddress,
              network: dbTx.network || 'USDT BEP-20',
              status: dbTx.status || 'Pending',
              createdAt: dbTx.createdAt || new Date()
            };
            this.pendingWithdrawals.set(txId, withdrawal);
          }
        }

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
   * Escape HTML special characters for Telegram messages
   */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render and send/edit the Complete User Profile & Audit Card
   */
  async sendUserProfileCard(chatId, userId, messageId = null) {
    if (!this.bot) return;

    try {
      const data = await dbService.getUserFullProfile(userId);
      if (!data || !data.user) {
        const notFoundText = `❌ <b>User Not Found!</b>\nNo user account found in database with ID <code>${userId}</code>.`;
        if (messageId) {
          await this.bot.api.editMessageText({
            chat_id: chatId,
            message_id: messageId,
            text: notFoundText,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Search Another User', callback_data: 'cmd_search_user' }],
                [{ text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }]
              ]
            }
          }).catch(() => {});
        } else {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: notFoundText,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Search Another User', callback_data: 'cmd_search_user' }],
                [{ text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }]
              ]
            }
          });
        }
        return;
      }

      const { user, miner, referralStats, purchasedNFTs, referrerUser, createdAt, effectiveDailyLimit, defaultLimit, todayWithdrawalCount, hasCustomLimit } = data;
      const totalUserFunds = parseFloat((user.balance + user.depositBalance).toFixed(4));
      const isBanned = user.isBanned === true;

      const regDateStr = createdAt
        ? new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        : 'N/A';

      let referrerDisplay = '<i>None (Direct)</i>';
      if (referrerUser) {
        referrerDisplay = `@${this.escapeHtml(referrerUser.username || 'user')} (<code>${referrerUser.telegramId}</code>)`;
      } else if (user.referrerId) {
        referrerDisplay = `UID: <code>${user.referrerId}</code>`;
      }

      const limitNote = hasCustomLimit
        ? `<code>${effectiveDailyLimit} times/day</code> [⚙️ <b>Custom Admin Override</b>]`
        : `<code>${effectiveDailyLimit} times/day</code> [⚡ <b>Default (${defaultLimit})</b>]`;

      const cardText = `👤 <b>USER DETAILS & AUDIT CARD</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Telegram UID:</b> <code>${user.telegramId}</code>
🌐 <b>Username:</b> ${user.username ? `@${this.escapeHtml(user.username)}` : '<i>No username</i>'}
📛 <b>Full Name:</b> ${this.escapeHtml(user.name)}
🔒 <b>Account Status:</b> ${isBanned ? '🚫 <b>BANNED / SUSPENDED</b>' : '🟢 <b>ACTIVE & VERIFIED</b>'}
📅 <b>Registered On:</b> <i>${regDateStr}</i>

💰 <b>FINANCIAL & BALANCES:</b>
• 💎 <b>Main (Withdrawable):</b> <code>${user.balance.toFixed(4)} USDT</code>
• 🛍️ <b>Deposit / NFT Balance:</b> <code>${user.depositBalance.toFixed(2)} USDT</code>
• 💵 <b>Total Overall Funds:</b> <code>${totalUserFunds.toFixed(4)} USDT</code>
• 📈 <b>Total Deposited:</b> <code>+${user.totalDeposited.toFixed(2)} USDT</code>
• 📤 <b>Total Withdrawn:</b> <code>${user.totalWithdrawn.toFixed(4)} USDT</code>
• 🎁 <b>Lifetime Earned:</b> <code>${user.totalEarned.toFixed(4)} USDT</code>

📤 <b>WITHDRAWAL LIMITS & USAGE:</b>
• ⏱️ <b>Daily Limit:</b> ${limitNote}
• ⏳ <b>Used Today:</b> <b>${todayWithdrawalCount} / ${effectiveDailyLimit} withdrawals</b>

⛏️ <b>MINER & DAILY MINING:</b>
• 🤖 <b>Current Miner:</b> ${this.escapeHtml(miner.name)} (Lv. ${miner.level} - ${miner.rarity})
• ⚡ <b>Hashrate Power:</b> <code>${miner.powerHashrate || '50 MH/s'}</code>
• 💰 <b>Daily Mining Rate:</b> <code>${user.miningRate.toFixed(4)} USDT/day</code>
• 📦 <b>Purchased NFT Plans:</b> <b>${(purchasedNFTs || []).length} Plan(s)</b>
• 🎁 <b>Gift Boxes:</b> <b>${user.giftBoxesAvailable}</b> Available (<b>${user.giftBoxesOpened}</b> Opened)
• 🚀 <b>Daily Speed Boost:</b> <code>+${user.dailySpeedBonus.toFixed(4)} USDT/day</code>

👥 <b>AFFILIATE & REFERRALS:</b>
• 🔗 <b>Referral Code:</b> <code>${user.referralCode}</code>
• 👤 <b>Invited By:</b> ${referrerDisplay}
• 👥 <b>Total Direct Referrals:</b> <b>${referralStats.invitedCount} Users</b>
• 💵 <b>Referral Earnings:</b> <code>+${referralStats.totalEarnings.toFixed(4)} USDT</code>

📍 <b>WALLET & SECURITY:</b>
• 💼 <b>Linked BEP-20 Wallet:</b> <code>${user.walletAddress || 'Not linked yet'}</code>
• 📱 <b>Device Fingerprint:</b> <code>${user.deviceFingerprint ? user.deviceFingerprint.slice(0, 16) + '...' : 'None'}</code>
• 🌐 <b>Last Known IP:</b> <code>${user.lastIp || 'N/A'}</code>
━━━━━━━━━━━━━━━━━━━━
⚡ <i>Select an action below to manage this user:</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '➕ Add Withdrawable Bal', callback_data: `user_addbal_menu:${user.telegramId}` },
            { text: '🛍️ Add Deposit Bal', callback_data: `user_adddep_menu:${user.telegramId}` }
          ],
          [
            { text: '➖ Deduct Balance', callback_data: `user_deduct_menu:${user.telegramId}` },
            { text: '⏱️ Set Withdraw Limit', callback_data: `user_limit_menu:${user.telegramId}` }
          ],
          [
            { text: '📋 View Transactions', callback_data: `user_txs:${user.telegramId}` },
            { text: '👥 View Referrals', callback_data: `user_refs:${user.telegramId}` }
          ],
          [
            { text: isBanned ? '✅ Unban Account' : '🚫 Ban Account', callback_data: isBanned ? `unban:${user.telegramId}` : `ban:${user.telegramId}` },
            { text: '🔄 Refresh Profile', callback_data: `user_refresh:${user.telegramId}` }
          ],
          [
            { text: '🔍 Search Another', callback_data: 'cmd_search_user' },
            { text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }
          ]
        ]
      };

      if (messageId) {
        await this.bot.api.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: cardText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        }).catch(async () => {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: cardText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: keyboard
          });
        });
      } else {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: cardText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });
      }
    } catch (err) {
      console.error('Error in sendUserProfileCard:', err);
    }
  }

  /**
   * Render Set Daily Withdrawal Limit Menu with Preset Buttons and Custom Options
   */
  async sendWithdrawLimitMenu(chatId, userId, messageId = null) {
    if (!this.bot) return;

    try {
      const data = await dbService.getUserFullProfile(userId);
      if (!data || !data.user) return;

      const { user, effectiveDailyLimit, defaultLimit, todayWithdrawalCount, hasCustomLimit } = data;

      const statusText = hasCustomLimit
        ? `⚙️ <b>Custom Admin Override:</b> <code>${effectiveDailyLimit} times/day</code>`
        : `⚡ <b>Standard System Default:</b> <code>${defaultLimit} times/day</code>`;

      const msgText = `⏱️ <b>SET DAILY WITHDRAWAL LIMIT</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Target User:</b> @${this.escapeHtml(user.username)} (UID: <code>${userId}</code>)
📊 <b>Current Daily Limit:</b> <b>${effectiveDailyLimit} times/day</b>
${statusText}
⏳ <b>Withdrawals Used Today:</b> <b>${todayWithdrawalCount} / ${effectiveDailyLimit}</b>
━━━━━━━━━━━━━━━━━━━━
👇 <i>Choose a quick daily limit preset below, or enter a custom limit:</i>`;

      const keyboardRows = [
        [
          { text: '1 Time/day', callback_data: `user_exec_limit:${userId}:1` },
          { text: '2 Times (Default)', callback_data: `user_exec_limit:${userId}:2` },
          { text: '3 Times/day', callback_data: `user_exec_limit:${userId}:3` }
        ],
        [
          { text: '5 Times/day', callback_data: `user_exec_limit:${userId}:5` },
          { text: '10 Times/day', callback_data: `user_exec_limit:${userId}:10` },
          { text: '20 Times/day', callback_data: `user_exec_limit:${userId}:20` }
        ],
        [
          { text: '🔄 Reset to Default (2/5)', callback_data: `user_reset_limit:${userId}` },
          { text: '✏️ Custom Limit', callback_data: `user_prompt_custom_limit:${userId}` }
        ],
        [
          { text: '🔙 Back to User Profile', callback_data: `user_view:${userId}` }
        ]
      ];

      if (messageId) {
        await this.bot.api.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: msgText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        }).catch(async () => {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: msgText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboardRows }
          });
        });
      } else {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: msgText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        });
      }
    } catch (err) {
      console.error('Error in sendWithdrawLimitMenu:', err);
    }
  }

  /**
   * Render Add/Deduct Balance Menu with Quick-Preset Buttons
   */
  async sendAddBalanceMenu(chatId, userId, balanceType = 'withdrawable', messageId = null) {
    if (!this.bot) return;

    try {
      const user = await dbService.getUser(userId);
      if (!user) return;

      let title = '';
      let currentBalText = '';
      let keyboardRows = [];

      if (balanceType === 'withdrawable') {
        title = `💰 <b>ADD WITHDRAWABLE BALANCE</b>`;
        currentBalText = `💎 <b>Current Balance:</b> <code>${user.balance.toFixed(4)} USDT</code>`;
        keyboardRows = [
          [
            { text: '+0.5 USDT', callback_data: `user_exec_addbal:${userId}:0.5` },
            { text: '+1.0 USDT', callback_data: `user_exec_addbal:${userId}:1` },
            { text: '+2.0 USDT', callback_data: `user_exec_addbal:${userId}:2` }
          ],
          [
            { text: '+5.0 USDT', callback_data: `user_exec_addbal:${userId}:5` },
            { text: '+10 USDT', callback_data: `user_exec_addbal:${userId}:10` },
            { text: '+25 USDT', callback_data: `user_exec_addbal:${userId}:25` }
          ],
          [
            { text: '+50 USDT', callback_data: `user_exec_addbal:${userId}:50` },
            { text: '+100 USDT', callback_data: `user_exec_addbal:${userId}:100` },
            { text: '✏️ Custom Amount', callback_data: `user_prompt_custom_bal:${userId}` }
          ],
          [
            { text: '🔙 Back to User Profile', callback_data: `user_view:${userId}` }
          ]
        ];
      } else if (balanceType === 'deposit') {
        title = `🛍️ <b>ADD DEPOSIT / NFT BALANCE</b>`;
        currentBalText = `🛍️ <b>Current Deposit Bal:</b> <code>${user.depositBalance.toFixed(2)} USDT</code>`;
        keyboardRows = [
          [
            { text: '+1.0 USDT', callback_data: `user_exec_adddep:${userId}:1` },
            { text: '+5.0 USDT', callback_data: `user_exec_adddep:${userId}:5` },
            { text: '+10 USDT', callback_data: `user_exec_adddep:${userId}:10` }
          ],
          [
            { text: '+25 USDT', callback_data: `user_exec_adddep:${userId}:25` },
            { text: '+50 USDT', callback_data: `user_exec_adddep:${userId}:50` },
            { text: '+100 USDT', callback_data: `user_exec_adddep:${userId}:100` }
          ],
          [
            { text: '✏️ Custom Amount', callback_data: `user_prompt_custom_dep:${userId}` },
            { text: '🔙 Back to User Profile', callback_data: `user_view:${userId}` }
          ]
        ];
      } else if (balanceType === 'deduct') {
        title = `➖ <b>DEDUCT WITHDRAWABLE BALANCE</b>`;
        currentBalText = `💎 <b>Current Balance:</b> <code>${user.balance.toFixed(4)} USDT</code>`;
        keyboardRows = [
          [
            { text: '-0.5 USDT', callback_data: `user_exec_deduct:${userId}:0.5` },
            { text: '-1.0 USDT', callback_data: `user_exec_deduct:${userId}:1` },
            { text: '-2.0 USDT', callback_data: `user_exec_deduct:${userId}:2` }
          ],
          [
            { text: '-5.0 USDT', callback_data: `user_exec_deduct:${userId}:5` },
            { text: '-10 USDT', callback_data: `user_exec_deduct:${userId}:10` },
            { text: '-25 USDT', callback_data: `user_exec_deduct:${userId}:25` }
          ],
          [
            { text: '✏️ Custom Deduct', callback_data: `user_prompt_custom_deduct:${userId}` },
            { text: '🔙 Back to User Profile', callback_data: `user_view:${userId}` }
          ]
        ];
      }

      const msgText = `${title}
━━━━━━━━━━━━━━━━━━━━
👤 <b>Target User:</b> @${this.escapeHtml(user.username)} (UID: <code>${userId}</code>)
${currentBalText}

👇 <i>Select a quick amount button below, or enter custom amount:</i>`;

      if (messageId) {
        await this.bot.api.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: msgText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        }).catch(async () => {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: msgText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboardRows }
          });
        });
      } else {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: msgText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        });
      }
    } catch (err) {
      console.error('Error in sendAddBalanceMenu:', err);
    }
  }

  /**
   * Render User Recent Transactions Audit
   */
  async sendUserTransactions(chatId, userId, messageId = null) {
    if (!this.bot) return;

    try {
      const user = await dbService.getUser(userId);
      const txs = await dbService.getTransactions(userId, 8);

      let msgText = `📋 <b>RECENT TRANSACTIONS AUDIT</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> @${this.escapeHtml(user?.username || 'user')} (UID: <code>${userId}</code>)
💎 <b>Current Balance:</b> <code>${(user?.balance || 0).toFixed(4)} USDT</code>
━━━━━━━━━━━━━━━━━━━━\n`;

      if (!txs || txs.length === 0) {
        msgText += `<i>No transaction history recorded yet for this user.</i>\n`;
      } else {
        txs.forEach((t, i) => {
          const sign = t.positive ? '🟢 +' : '🔴 -';
          const cleanAmt = String(t.amount || '').replace(/^[+-]/, '');
          const statusBadge = t.status === 'Completed' || t.status === 'Success' ? '✅' : (t.status === 'Pending' ? '⏳' : '❌');
          msgText += `${i + 1}. ${statusBadge} <b>${this.escapeHtml(t.type)}</b>\n   💵 <code>${sign}${cleanAmt}</code> | <i>${t.date || 'Recently'}</i>\n`;
          if (t.txHash) {
            msgText += `   🔗 TxID: <code>${this.escapeHtml(t.txHash.slice(0, 24))}...</code>\n`;
          }
          msgText += `\n`;
        });
      }
      msgText += `━━━━━━━━━━━━━━━━━━━━`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Refresh Tx', callback_data: `user_txs:${userId}` },
            { text: '🔙 Back to User Profile', callback_data: `user_view:${userId}` }
          ],
          [
            { text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }
          ]
        ]
      };

      if (messageId) {
        await this.bot.api.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: msgText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        }).catch(async () => {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: msgText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: keyboard
          });
        });
      } else {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: msgText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });
      }
    } catch (err) {
      console.error('Error in sendUserTransactions:', err);
    }
  }

  /**
   * Render User Referral Network Audit
   */
  async sendUserReferrals(chatId, userId, messageId = null) {
    if (!this.bot) return;

    try {
      const user = await dbService.getUser(userId);
      const refData = await dbService.getReferrals(userId);
      const list = refData.referralsList || [];

      let msgText = `👥 <b>REFERRAL NETWORK AUDIT</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> @${this.escapeHtml(user?.username || 'user')} (UID: <code>${userId}</code>)
🔗 <b>Referral Code:</b> <code>${user?.referralCode || 'N/A'}</code>
👥 <b>Total Direct Referrals:</b> <b>${refData.invitedCount} Users</b>
💵 <b>Total Commission Earned:</b> <code>+${refData.totalEarnings.toFixed(4)} USDT</code>
━━━━━━━━━━━━━━━━━━━━\n`;

      if (list.length === 0) {
        msgText += `<i>This user has not invited any active users yet.</i>\n`;
      } else {
        msgText += `<b>Top Invited Users:</b>\n`;
        list.slice(0, 10).forEach((r, i) => {
          msgText += `${i + 1}. 👤 @${this.escapeHtml(r.username || 'user')} (<code>${r.id}</code>)\n   💰 Earned: <code>${r.commission}</code> | <i>${r.date}</i>\n\n`;
        });
        if (list.length > 10) {
          msgText += `<i>...and ${list.length - 10} more referrals.</i>\n`;
        }
      }
      msgText += `━━━━━━━━━━━━━━━━━━━━`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔙 Back to User Profile', callback_data: `user_view:${userId}` }
          ],
          [
            { text: '🏠 Admin Dashboard', callback_data: 'cmd_dashboard' }
          ]
        ]
      };

      if (messageId) {
        await this.bot.api.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: msgText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        }).catch(async () => {
          await this.bot.api.sendMessage({
            chat_id: chatId,
            text: msgText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: keyboard
          });
        });
      } else {
        await this.bot.api.sendMessage({
          chat_id: chatId,
          text: msgText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });
      }
    } catch (err) {
      console.error('Error in sendUserReferrals:', err);
    }
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
            { text: '🔍 Search User', callback_data: 'cmd_search_user' }
          ],
          [
            { text: `📋 Pending Requests (${stats.pendingWithdrawalsCount})`, callback_data: 'cmd_pending' },
            { text: '💼 Check Wallet', callback_data: 'cmd_balance' }
          ],
          [
            { text: '📢 Test Proof Post', callback_data: 'cmd_testchannel' },
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
      const pendingTxs = await dbService.getPendingWithdrawals(20);

      if (pendingTxs.length === 0) {
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
      const keyboard = [];

      pendingTxs.forEach((tx, idx) => {
        msg += `${idx + 1}. 🆔 <code>${tx.id}</code>\n   👤 User: <code>${tx.userId}</code> | 💰 <b>${tx.amount}</b>\n   📍 To: <code>${tx.recipientAddress || 'N/A'}</code>\n\n`;
        if (idx < 5) {
          keyboard.push([
            { text: `✅ Approve ${tx.id}`, callback_data: `approve:${tx.id}` },
            { text: `❌ Reject ${tx.id}`, callback_data: `reject:${tx.id}` }
          ]);
        }
      });
      msg += `<i>Use the inline action buttons below to Approve & Pay or Reject:</i>`;

      keyboard.push([{ text: '🔄 Refresh Dashboard', callback_data: 'cmd_dashboard' }]);

      await this.bot.api.sendMessage({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
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
