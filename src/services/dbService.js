const db = require('../config/db');

class DBService {
  /**
   * Helper to lookup referrer ID by referral code, tgId, or startParam
   */
  async findReferrerIdByCode(code) {
    if (!code) return null;
    const cleanStr = String(code).trim();
    if (!cleanStr) return null;

    const numericPart = parseInt(cleanStr.replace(/\D/g, ''), 10) || 0;
    const directNum = isNaN(cleanStr) ? 0 : Number(cleanStr);

    try {
      const res = await db.query(`
        SELECT telegram_id FROM users
        WHERE UPPER(referral_code) = UPPER($1)
           OR UPPER(referral_code) = UPPER($2)
           OR UPPER(referral_code) = UPPER($3)
           OR telegram_id = $4
           OR telegram_id = $5
        LIMIT 1;
      `, [
        cleanStr,
        `REF-${cleanStr.replace(/^(REF|ref)-/i, '')}`,
        `CRYPTO-${cleanStr.replace(/^(CRYPTO|crypto)-/i, '')}`,
        directNum,
        numericPart
      ]);

      if (res.rows.length > 0) {
        return res.rows[0].telegram_id;
      }
    } catch (err) {
      console.warn('findReferrerIdByCode warning:', err.message);
    }
    return null;
  }

  /**
   * Get or create a user by Telegram ID with Anti-Multi Account Protection
   */
  async getUser(telegramId = 9482103, meta = {}, clientInfo = {}) {
    try {
      const tgId = Number(telegramId) || 9482103;
      const res = await db.query('SELECT * FROM users WHERE telegram_id = $1', [tgId]);

      const client = (clientInfo.ip || clientInfo.fingerprint) ? clientInfo : (meta.clientInfo || {});
      const clientIp = (client.ip || '').trim();
      const deviceFp = (client.fingerprint || '').trim();
      const userAgent = (client.userAgent || '').trim();

      // Resolve effective referrer if provided via direct ID or startParam/code
      let effectiveReferrerId = meta.referrerId ? Number(meta.referrerId) : null;
      if (!effectiveReferrerId && (meta.startParam || meta.referralCode)) {
        effectiveReferrerId = await this.findReferrerIdByCode(meta.startParam || meta.referralCode);
      }
      if (effectiveReferrerId && Number(effectiveReferrerId) === tgId) {
        effectiveReferrerId = null; // Cannot refer oneself
      }
      
      if (res.rows.length > 0) {
        const existing = res.rows[0];

        // Track & update IP / device fingerprint for existing user
        const updates = {};
        if (clientIp && clientIp !== existing.last_ip) updates.last_ip = clientIp;
        if (deviceFp && !existing.device_fingerprint) updates.device_fingerprint = deviceFp;
        if (userAgent && !existing.user_agent) updates.user_agent = userAgent;

        // If user already exists in DB but doesn't have a referrer_id linked yet
        if (!existing.referrer_id && effectiveReferrerId && !existing.is_banned) {
          // Check if self-referring from same device / IP
          let isSelfRef = false;
          if (deviceFp || clientIp) {
            const refCheck = await db.query('SELECT telegram_id, last_ip, device_fingerprint FROM users WHERE telegram_id = $1', [effectiveReferrerId]);
            if (refCheck.rows.length > 0) {
              const rUser = refCheck.rows[0];
              if ((deviceFp && rUser.device_fingerprint === deviceFp) || (clientIp && clientIp !== '127.0.0.1' && rUser.last_ip === clientIp)) {
                isSelfRef = true;
              }
            }
          }

          if (!isSelfRef) {
            await db.query('UPDATE users SET referrer_id = $1 WHERE telegram_id = $2', [effectiveReferrerId, tgId]);
            existing.referrer_id = effectiveReferrerId;

            await this.addReferral(effectiveReferrerId, {
              referredId: tgId,
              username: existing.username,
              firstName: existing.first_name,
              level: 1,
              commissionEarned: 0.00
            });

            // Award +1 Mystery Gift Box to referrer
            await db.query(`
              UPDATE users 
              SET gift_boxes_available = COALESCE(gift_boxes_available, 0) + 1 
              WHERE telegram_id = $1;
            `, [effectiveReferrerId]);

            try {
              const mainBotService = require('./mainBotService');
              if (mainBotService?.notifyReferrerNewUser) {
                mainBotService.notifyReferrerNewUser(effectiveReferrerId, existing.username, existing.first_name);
              }
            } catch (e) {}
          }
        }

        // Optionally update profile details if new metadata provided
        if (meta.username && meta.username !== existing.username) updates.username = meta.username;
        if (meta.firstName && meta.firstName !== existing.first_name) updates.first_name = meta.firstName;
        if (meta.lastName && meta.lastName !== existing.last_name) updates.last_name = meta.lastName;
        if (meta.avatar && meta.avatar !== existing.avatar) updates.avatar = meta.avatar;

        if (Object.keys(updates).length > 0) {
          return await this.updateUser(tgId, updates);
        }
        return this.formatUser(existing);
      }

      // --- MULTI-ACCOUNT ABUSE DETECTION FOR NEW USERS ---
      let isBanned = false;
      let banReason = null;
      let matchedUser = null;

      // 1. Device Fingerprint collision check (High accuracy)
      if (deviceFp && deviceFp.length > 5) {
        const dupFp = await db.query(
          'SELECT telegram_id, username, first_name FROM users WHERE device_fingerprint = $1 AND telegram_id != $2 LIMIT 1',
          [deviceFp, tgId]
        );
        if (dupFp.rows.length > 0) {
          isBanned = true;
          banReason = 'Multiple ID Abuse: Same Device Fingerprint detected';
          matchedUser = dupFp.rows[0];
          console.warn(`🚨 [Anti-Multi] Device FP match: UID ${tgId} matches existing UID ${matchedUser.telegram_id}`);
        }
      }

      // 2. IP Collision & Self-Referral check (Excluding local loopbacks)
      if (!isBanned && clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1' && !clientIp.startsWith('192.168.') && !clientIp.startsWith('10.')) {
        if (effectiveReferrerId) {
          const refRes = await db.query('SELECT telegram_id, username, last_ip, device_fingerprint FROM users WHERE telegram_id = $1', [effectiveReferrerId]);
          if (refRes.rows.length > 0 && refRes.rows[0].last_ip === clientIp) {
            isBanned = true;
            banReason = 'Multiple ID Abuse: Self-referral from same IP';
            matchedUser = refRes.rows[0];
            console.warn(`🚨 [Anti-Multi] Self-referral IP match: UID ${tgId} created from referrer IP ${clientIp}`);
          }
        }
      }

      // If banned, cancel referral link and rewards
      if (isBanned) {
        effectiveReferrerId = null;
      }

      // Auto-create user in Neon Database
      const username = meta.username || `user_${tgId}`;
      const firstName = meta.firstName || 'Miner';
      const lastName = meta.lastName || `#${tgId}`;
      const referralCode = `REF-${tgId}`;
      const avatar = meta.avatar || '/assets/images/nft/miner-robot.png';

      const newUser = await db.query(`
        INSERT INTO users (
          telegram_id, username, first_name, last_name,
          balance, deposit_balance, ton_balance, total_earned,
          total_withdrawn, total_deposited, mining_rate, referral_code,
          referrer_id, vip_tier, vip_power_multiplier, wallet_address, avatar,
          is_banned, ban_reason, device_fingerprint, last_ip, user_agent,
          gift_boxes_available, gift_boxes_opened, daily_speed_bonus
        ) VALUES (
          $1, $2, $3, $4,
          0.0000, 0.0000, 0.0000, 0.0000,
          0.0000, 0.0000, 0.0200, $5,
          $6, 'Standard Tier', 1.00, null, $7,
          $8, $9, $10, $11, $12,
          $13, 0, 0.0000
        ) RETURNING *;
      `, [
        tgId,
        username,
        firstName,
        lastName,
        referralCode,
        effectiveReferrerId || null,
        avatar,
        isBanned,
        banReason,
        deviceFp || null,
        clientIp || null,
        userAgent || null,
        isBanned ? 0 : 1
      ]);

      // If multi-account was detected, notify Admin Bot in real time
      if (isBanned) {
        try {
          const telegramBotService = require('./telegramBotService');
          if (telegramBotService?.notifyMultiAccountAbuse) {
            telegramBotService.notifyMultiAccountAbuse({
              userId: tgId,
              username: username,
              matchedUserId: matchedUser?.telegram_id,
              matchedUsername: matchedUser?.username,
              deviceFp: deviceFp,
              ip: clientIp,
              reason: banReason
            });
          }
        } catch (e) {}
      }

      // Initialize default active miner for this user (Free Starter Mining: 0.02 USDT/day for 10 days = 0.20 USDT total)
      await db.query(`
        INSERT INTO active_miners (
          user_id, miner_id, name, level, rarity, status,
          purchase_price, daily_reward, total_claim, total_reward, max_reward,
          mining_days, days_completed, power_hashrate, upgrade_cost,
          next_level, next_level_reward, next_level_hashrate, image, cycle_start_time
        ) VALUES (
          $1, 'starter', 'Free Starter Miner', 1, 'Common', 'Active',
          0.0000, 0.0200, 0.0000, 0.0000, 0.2000,
          10, 0, '50 MH/s', 0.5000,
          2, 0.0500, '100 MH/s', '/assets/images/nft/miner-robot.png', $2
        ) ON CONFLICT (user_id) DO NOTHING;
      `, [tgId, Date.now()]);

      // Initialize streak/tasks for this user
      await db.query(`
        INSERT INTO streaks_tasks (
          user_id, streak_current_day, streak_claimed_today, completed_task_ids
        ) VALUES (
          $1, 1, false, '{task-tg-sub,task-yt-sub}'
        ) ON CONFLICT (user_id) DO NOTHING;
      `, [tgId]);

      // If registered with clean referrer, record referral link, award +1 box, and notify referrer
      if (effectiveReferrerId && effectiveReferrerId !== tgId && !isBanned) {
        await this.addReferral(effectiveReferrerId, {
          referredId: tgId,
          username,
          firstName,
          level: 1,
          commissionEarned: 0.00
        });

        // Award +1 Mystery Gift Box to referrer
        await db.query(`
          UPDATE users 
          SET gift_boxes_available = COALESCE(gift_boxes_available, 0) + 1 
          WHERE telegram_id = $1;
        `, [effectiveReferrerId]);

        try {
          const mainBotService = require('./mainBotService');
          if (mainBotService?.notifyReferrerNewUser) {
            mainBotService.notifyReferrerNewUser(effectiveReferrerId, username, firstName);
          }
        } catch (e) {}
      }

      return this.formatUser(newUser.rows[0]);
    } catch (err) {
      console.error('DBService.getUser Error:', err);
      throw err;
    }
  }

  formatUser(row) {
    if (!row) return null;
    return {
      id: parseInt(row.id),
      telegramId: row.telegram_id ? row.telegram_id.toString() : '9482103',
      username: row.username || 'cryptominer_pro',
      name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.username || 'Alex Miner',
      firstName: row.first_name || 'Alex',
      lastName: row.last_name || 'Miner',
      balance: parseFloat(row.balance || 0),
      depositBalance: parseFloat(row.deposit_balance || 0), // NFT Purchase / Deposit Balance (Non-withdrawable)
      tonBalance: parseFloat(row.ton_balance || 0),
      totalEarned: parseFloat(row.total_earned || 0),
      totalWithdrawn: parseFloat(row.total_withdrawn || 0),
      totalDeposited: parseFloat(row.total_deposited || 0),
      miningRate: parseFloat(row.mining_rate || 0.0200),
      giftBoxesAvailable: parseInt(row.gift_boxes_available !== undefined && row.gift_boxes_available !== null ? row.gift_boxes_available : 0),
      giftBoxesOpened: parseInt(row.gift_boxes_opened || 0),
      dailySpeedBonus: parseFloat(row.daily_speed_bonus || 0.0000),
      referralCode: row.referral_code || 'CRYPTO-9482',
      referrerId: row.referrer_id,
      vipTier: row.vip_tier || 'Standard Tier',
      vipPowerMultiplier: parseFloat(row.vip_power_multiplier || 1.0),
      walletAddress: (row.wallet_address && !row.wallet_address.includes('...')) ? row.wallet_address : null,
      avatar: row.avatar || '/assets/images/nft/miner-robot.png',
      isBanned: row.is_banned === true,
      banReason: row.ban_reason || null,
      deviceFingerprint: row.device_fingerprint || null,
      lastIp: row.last_ip || null,
      isMiningActive: true
    };
  }

  /**
   * Ban User in Neon Database
   */
  async banUser(telegramId) {
    try {
      const tgId = Number(telegramId);
      const res = await db.query(`
        UPDATE users
        SET is_banned = TRUE, updated_at = NOW()
        WHERE telegram_id = $1
        RETURNING *;
      `, [tgId]);
      return res.rows.length > 0 ? this.formatUser(res.rows[0]) : null;
    } catch (err) {
      console.error('DBService.banUser Error:', err);
      throw err;
    }
  }

  /**
   * Unban User in Neon Database
   */
  async unbanUser(telegramId) {
    try {
      const tgId = Number(telegramId);
      const res = await db.query(`
        UPDATE users
        SET is_banned = FALSE, updated_at = NOW()
        WHERE telegram_id = $1
        RETURNING *;
      `, [tgId]);
      return res.rows.length > 0 ? this.formatUser(res.rows[0]) : null;
    } catch (err) {
      console.error('DBService.unbanUser Error:', err);
      throw err;
    }
  }

  /**
   * Check if User is Banned
   */
  async isUserBanned(telegramId) {
    try {
      const tgId = Number(telegramId);
      const res = await db.query('SELECT is_banned FROM users WHERE telegram_id = $1', [tgId]);
      return res.rows.length > 0 && res.rows[0].is_banned === true;
    } catch (err) {
      console.error('DBService.isUserBanned Error:', err);
      return false;
    }
  }

  /**
   * Update User record in Neon Database
   */
  async updateUser(telegramId = 9482103, updates = {}) {
    try {
      const tgId = Number(telegramId) || 9482103;
      const keys = Object.keys(updates);
      if (keys.length === 0) return await this.getUser(tgId);

      const fieldMap = {
        balance: 'balance',
        depositBalance: 'deposit_balance',
        tonBalance: 'ton_balance',
        totalEarned: 'total_earned',
        totalWithdrawn: 'total_withdrawn',
        totalDeposited: 'total_deposited',
        miningRate: 'mining_rate',
        vipTier: 'vip_tier',
        vipPowerMultiplier: 'vip_power_multiplier',
        walletAddress: 'wallet_address',
        username: 'username',
        firstName: 'first_name',
        lastName: 'last_name',
        avatar: 'avatar',
        referralCode: 'referral_code',
        isBanned: 'is_banned',
        banReason: 'ban_reason',
        deviceFingerprint: 'device_fingerprint',
        lastIp: 'last_ip',
        userAgent: 'user_agent',
        giftBoxesAvailable: 'gift_boxes_available',
        giftBoxesOpened: 'gift_boxes_opened',
        dailySpeedBonus: 'daily_speed_bonus'
      };

      const setClauses = [];
      const values = [];
      let idx = 1;

      for (const key of keys) {
        const col = fieldMap[key];
        if (col) {
          setClauses.push(`${col} = $${idx}`);
          values.push(updates[key]);
          idx++;
        }
      }

      if (setClauses.length === 0) return await this.getUser(tgId);

      setClauses.push(`updated_at = NOW()`);
      values.push(tgId);

      const query = `
        UPDATE users
        SET ${setClauses.join(', ')}
        WHERE telegram_id = $${idx}
        RETURNING *;
      `;

      const res = await db.query(query, values);
      if (res.rows.length === 0) {
        return await this.getUser(tgId);
      }
      return this.formatUser(res.rows[0]);
    } catch (err) {
      console.error('DBService.updateUser Error:', err);
      throw err;
    }
  }

  /**
   * Get Active Miner for user from Neon Database
   */
  async getActiveMiner(userId = 9482103) {
    try {
      const tgId = Number(userId) || 9482103;
      const res = await db.query('SELECT * FROM active_miners WHERE user_id = $1', [tgId]);
      if (res.rows.length > 0) {
        return this.formatMiner(res.rows[0]);
      }

      // Default miner if not present (Free Starter Mining: 0.02 USDT/day for 10 days = 0.20 USDT total)
      const newMiner = await db.query(`
        INSERT INTO active_miners (
          user_id, miner_id, name, level, rarity, status,
          purchase_price, daily_reward, total_claim, total_reward, max_reward,
          mining_days, days_completed, power_hashrate, upgrade_cost,
          next_level, next_level_reward, next_level_hashrate, image, cycle_start_time
        ) VALUES (
          $1, 'starter', 'Free Starter Miner', 1, 'Common', 'Active',
          0.0000, 0.0200, 0.0000, 0.0000, 0.2000,
          10, 0, '50 MH/s', 0.5000,
          2, 0.0500, '100 MH/s', '/assets/images/nft/miner-robot.png', $2
        ) RETURNING *;
      `, [tgId, Date.now()]);

      return this.formatMiner(newMiner.rows[0]);
    } catch (err) {
      console.error('DBService.getActiveMiner Error:', err);
      throw err;
    }
  }

  formatMiner(row) {
    if (!row) return null;
    return {
      id: row.miner_id || 'starter',
      name: row.name || 'Free Starter Miner',
      level: parseInt(row.level || 1),
      rarity: row.rarity || 'Common',
      status: row.status || 'Active',
      purchasePrice: parseFloat(row.purchase_price || 0.0),
      dailyReward: parseFloat(row.daily_reward !== null && row.daily_reward !== undefined ? row.daily_reward : 0.0200),
      totalReward: parseFloat(row.total_reward !== null && row.total_reward !== undefined ? row.total_reward : 0.0000),
      totalClaim: parseFloat(row.total_claim !== null && row.total_claim !== undefined ? row.total_claim : 0.0000),
      maxReward: parseFloat(row.max_reward || 0.2000),
      miningDays: parseInt(row.mining_days || 10),
      daysCompleted: parseInt(row.days_completed || 0),
      powerHashrate: row.power_hashrate || '50 MH/s',
      upgradeCost: parseFloat(row.upgrade_cost || 0.50),
      nextLevel: parseInt(row.next_level || 2),
      nextLevelReward: parseFloat(row.next_level_reward || 0.0500),
      nextLevelHashrate: row.next_level_hashrate || '100 MH/s',
      image: row.image || '/assets/images/nft/miner-robot.png',
      cycleStartTime: row.cycle_start_time ? parseInt(row.cycle_start_time) : Date.now()
    };
  }

  /**
   * Update Active Miner in Neon Database
   */
  async updateActiveMiner(userId = 9482103, updates = {}) {
    try {
      const tgId = Number(userId) || 9482103;
      const fieldMap = {
        id: 'miner_id',
        miner_id: 'miner_id',
        name: 'name',
        level: 'level',
        rarity: 'rarity',
        status: 'status',
        purchasePrice: 'purchase_price',
        purchase_price: 'purchase_price',
        dailyReward: 'daily_reward',
        daily_reward: 'daily_reward',
        totalReward: 'total_reward',
        total_reward: 'total_reward',
        totalClaim: 'total_claim',
        total_claim: 'total_claim',
        maxReward: 'max_reward',
        max_reward: 'max_reward',
        miningDays: 'mining_days',
        mining_days: 'mining_days',
        daysCompleted: 'days_completed',
        days_completed: 'days_completed',
        powerHashrate: 'power_hashrate',
        power_hashrate: 'power_hashrate',
        upgradeCost: 'upgrade_cost',
        upgrade_cost: 'upgrade_cost',
        nextLevel: 'next_level',
        next_level: 'next_level',
        nextLevelReward: 'next_level_reward',
        next_level_reward: 'next_level_reward',
        nextLevelHashrate: 'next_level_hashrate',
        next_level_hashrate: 'next_level_hashrate',
        image: 'image',
        cycleStartTime: 'cycle_start_time',
        cycle_start_time: 'cycle_start_time'
      };

      const setClauses = [];
      const values = [];
      let idx = 1;

      for (const [k, v] of Object.entries(updates)) {
        const col = fieldMap[k];
        if (col) {
          setClauses.push(`${col} = $${idx}`);
          values.push(v);
          idx++;
        }
      }

      if (setClauses.length === 0) return await this.getActiveMiner(tgId);

      setClauses.push(`updated_at = NOW()`);
      values.push(tgId);

      const query = `
        UPDATE active_miners
        SET ${setClauses.join(', ')}
        WHERE user_id = $${idx}
        RETURNING *;
      `;

      const res = await db.query(query, values);
      if (res.rows.length === 0) {
        return await this.getActiveMiner(tgId);
      }
      return this.formatMiner(res.rows[0]);
    } catch (err) {
      console.error('DBService.updateActiveMiner Error:', err);
      throw err;
    }
  }

  /**
   * Add a Transaction record with TxID to Neon Database
   */
  async addTransaction(tx) {
    try {
      const id = tx.id || `tx-${Date.now()}`;
      const userId = Number(tx.userId) || 9482103;
      const type = tx.type || 'Transaction';
      const amount = tx.amount || '0.00 USDT';
      const txHash = tx.txHash || null;
      const recipientAddress = tx.recipientAddress || null;
      const network = tx.network || null;
      const status = tx.status || 'Completed';
      const positive = tx.positive !== undefined ? tx.positive : true;
      const dateStr = tx.date || 'Just now';

      const res = await db.query(`
        INSERT INTO transactions (
          id, user_id, type, amount, tx_hash,
          recipient_address, network, status, positive, date_str
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10
        ) RETURNING *;
      `, [
        id, userId, type, amount, txHash,
        recipientAddress, network, status, positive, dateStr
      ]);

      return res.rows[0];
    } catch (err) {
      console.error('DBService.addTransaction Error:', err);
      throw err;
    }
  }

  /**
   * Update Transaction Status (e.g. for Payout Approval / Rejection / Tx Hash update)
   */
  async updateTransaction(txId, updates = {}) {
    try {
      const setClauses = [];
      const values = [];
      let idx = 1;

      if (updates.status) {
        setClauses.push(`status = $${idx}`);
        values.push(updates.status);
        idx++;
      }
      if (updates.txHash) {
        setClauses.push(`tx_hash = $${idx}`);
        values.push(updates.txHash);
        idx++;
      }

      if (setClauses.length === 0) return null;

      values.push(txId);
      const query = `
        UPDATE transactions
        SET ${setClauses.join(', ')}
        WHERE id = $${idx}
        RETURNING *;
      `;

      const res = await db.query(query, values);
      return res.rows[0] || null;
    } catch (err) {
      console.error('DBService.updateTransaction Error:', err);
      return null;
    }
  }

  /**
   * Get Transactions list for user from Neon Database
   */
  async getTransactions(userId = 9482103, limit = 50) {
    try {
      const tgId = Number(userId) || 9482103;
      const res = await db.query(`
        SELECT * FROM transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2;
      `, [tgId, limit]);

      return res.rows.map(r => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        txHash: r.tx_hash,
        recipientAddress: r.recipient_address,
        network: r.network,
        status: r.status,
        positive: r.positive,
        date: r.date_str
      }));
    } catch (err) {
      console.error('DBService.getTransactions Error:', err);
      return [];
    }
  }

  /**
   * Get Referrals stats and list from Neon Database (Real-time sync)
   */
  async getReferrals(userId = 9482103) {
    try {
      const tgId = Number(userId) || 9482103;

      // 1. Fetch from referrals table
      const res = await db.query(`
        SELECT * FROM referrals
        WHERE referrer_id = $1
        ORDER BY created_at DESC;
      `, [tgId]);

      // 2. Also check if there are users in users table with referrer_id = $1 not yet in referrals
      const uRes = await db.query(`
        SELECT telegram_id, username, first_name, created_at
        FROM users
        WHERE referrer_id = $1;
      `, [tgId]);

      const map = new Map();

      // Add users from referrals table
      res.rows.forEach(r => {
        map.set(String(r.referred_id), {
          id: r.referred_id,
          name: r.first_name || r.username || `User #${r.referred_id}`,
          username: r.username || `user_${r.referred_id}`,
          level: `Tier ${r.level || 1}`,
          earned: `${parseFloat(r.commission_earned || 0).toFixed(2)} USDT`,
          commission: `+${parseFloat(r.commission_earned || 0).toFixed(2)} USDT`,
          rawCommission: parseFloat(r.commission_earned || 0),
          date: new Date(r.created_at).toLocaleDateString(),
          active: true
        });
      });

      // Add any missing users from users table
      uRes.rows.forEach(u => {
        if (!map.has(String(u.telegram_id))) {
          map.set(String(u.telegram_id), {
            id: u.telegram_id,
            name: u.first_name || u.username || `User #${u.telegram_id}`,
            username: u.username || `user_${u.telegram_id}`,
            level: 'Tier 1',
            earned: '0.00 USDT',
            commission: '+0.00 USDT',
            rawCommission: 0.00,
            date: new Date(u.created_at).toLocaleDateString(),
            active: true
          });
        }
      });

      const list = Array.from(map.values());
      const totalCommission = list.reduce((sum, r) => sum + r.rawCommission, 0);

      return {
        invitedCount: list.length,
        totalEarnings: parseFloat(totalCommission.toFixed(4)),
        referralsList: list
      };
    } catch (err) {
      console.error('DBService.getReferrals Error:', err);
      return { invitedCount: 0, totalEarnings: 0, referralsList: [] };
    }
  }

  /**
   * Add Referral tracking
   */
  async addReferral(referrerId, data = {}) {
    try {
      const res = await db.query(`
        INSERT INTO referrals (
          referrer_id, referred_id, username, first_name, level, commission_earned
        ) VALUES (
          $1, $2, $3, $4, $5, $6
        ) ON CONFLICT (referrer_id, referred_id) DO UPDATE
        SET commission_earned = referrals.commission_earned + EXCLUDED.commission_earned
        RETURNING *;
      `, [
        Number(referrerId),
        Number(data.referredId),
        data.username || `user_${data.referredId}`,
        data.firstName || 'Miner',
        data.level || 1,
        data.commissionEarned || 0.0000
      ]);
      return res.rows[0];
    } catch (err) {
      console.error('DBService.addReferral Error:', err);
      return null;
    }
  }

  /**
   * Distribute Referral Commission:
   * Level 1 (Direct Referrer) receives a flat 0.02$ (+0.0200 USDT) directly to their main withdraw balance.
   * Level 2 and Level 3 receive 0$ (visual UI display only).
   */
  async distributeReferralCommission(userId, sourceAmount, sourceAction = 'Deposit') {
    try {
      // 1. Get user and their direct referrer (Tier 1)
      const uRes = await db.query('SELECT telegram_id, username, first_name, referrer_id FROM users WHERE telegram_id = $1', [Number(userId)]);
      if (uRes.rows.length === 0 || !uRes.rows[0].referrer_id) return;

      const actor = uRes.rows[0];
      const tier1Id = actor.referrer_id;

      // Tier 1 direct referrer gets flat 0.02$ (0.0200 USDT) added to their main withdrawable balance
      const comm1 = 0.0200;
      if (tier1Id) {
        await db.query(`
          UPDATE users 
          SET balance = balance + $1, total_earned = total_earned + $1 
          WHERE telegram_id = $2;
        `, [comm1, tier1Id]);

        await this.addReferral(tier1Id, {
          referredId: actor.telegram_id,
          username: actor.username,
          firstName: actor.first_name,
          level: 1,
          commissionEarned: comm1
        });

        await this.addTransaction({
          id: `tx-ref1-${Date.now()}-${Math.floor(Math.random()*1000)}`,
          userId: tier1Id,
          type: `Referral Commission (Tier 1 - ${sourceAction})`,
          amount: `+${comm1.toFixed(4)} USDT`,
          txHash: `ref_t1_${actor.telegram_id}_${Date.now()}`,
          recipientAddress: actor.username ? `@${actor.username}` : `User #${actor.telegram_id}`,
          network: 'CryptoMine Network',
          status: 'Completed',
          positive: true,
          date: 'Just now'
        });

        try {
          const mainBotService = require('./mainBotService');
          if (mainBotService?.notifyReferrerCommission) {
            mainBotService.notifyReferrerCommission(tier1Id, comm1, 1, sourceAction);
          }
        } catch (e) {}
      }

      // Tier 2 and Tier 3 receive 0$ as per requirement (visual display only on frontend)
    } catch (err) {
      console.error('DBService.distributeReferralCommission error:', err);
    }
  }

  /**
   * Get Streak and Tasks from Neon Database
   */
  async getStreakAndTasks(userId = 9482103) {
    try {
      const tgId = Number(userId) || 9482103;
      const res = await db.query('SELECT * FROM streaks_tasks WHERE user_id = $1', [tgId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          currentDay: row.streak_current_day || 1,
          claimedToday: row.streak_claimed_today || false,
          lastClaimDate: row.streak_last_claim_date,
          completedTaskIds: row.completed_task_ids || []
        };
      }

      await db.query(`
        INSERT INTO streaks_tasks (
          user_id, streak_current_day, streak_claimed_today, completed_task_ids
        ) VALUES (
          $1, 1, false, '{task-tg-sub,task-yt-sub}'
        ) ON CONFLICT (user_id) DO NOTHING;
      `, [tgId]);

      return { currentDay: 1, claimedToday: false, lastClaimDate: null, completedTaskIds: ['task-tg-sub', 'task-yt-sub'] };
    } catch (err) {
      console.error('DBService.getStreakAndTasks Error:', err);
      return { currentDay: 1, claimedToday: false, lastClaimDate: null, completedTaskIds: [] };
    }
  }

  /**
   * Update Streak and Tasks in Neon Database
   */
  async updateStreakAndTasks(userId = 9482103, updates = {}) {
    try {
      const tgId = Number(userId) || 9482103;
      const setClauses = [];
      const values = [];
      let idx = 1;

      if (updates.currentDay !== undefined) {
        setClauses.push(`streak_current_day = $${idx}`);
        values.push(updates.currentDay);
        idx++;
      }
      if (updates.claimedToday !== undefined) {
        setClauses.push(`streak_claimed_today = $${idx}`);
        values.push(updates.claimedToday);
        idx++;
      }
      if (updates.lastClaimDate !== undefined) {
        setClauses.push(`streak_last_claim_date = $${idx}`);
        values.push(updates.lastClaimDate);
        idx++;
      }
      if (updates.completedTaskIds !== undefined) {
        setClauses.push(`completed_task_ids = $${idx}`);
        values.push(updates.completedTaskIds);
        idx++;
      }

      if (setClauses.length === 0) return await this.getStreakAndTasks(tgId);

      setClauses.push(`updated_at = NOW()`);
      values.push(tgId);

      const res = await db.query(`
        UPDATE streaks_tasks
        SET ${setClauses.join(', ')}
        WHERE user_id = $${idx}
        RETURNING *;
      `, values);

      if (res.rows.length === 0) return await this.getStreakAndTasks(tgId);
      const row = res.rows[0];
      return {
        currentDay: row.streak_current_day,
        claimedToday: row.streak_claimed_today,
        lastClaimDate: row.streak_last_claim_date,
        completedTaskIds: row.completed_task_ids
      };
    } catch (err) {
      console.error('DBService.updateStreakAndTasks Error:', err);
      throw err;
    }
  }

  /**
   * Count user withdrawals made today (within the current calendar day UTC)
   */
  async getDailyWithdrawalCount(userId) {
    try {
      const tgId = Number(userId) || 9482103;
      const res = await db.query(`
        SELECT COUNT(*) AS count
        FROM transactions
        WHERE user_id = $1
          AND type ILIKE '%Withdraw%'
          AND created_at >= (NOW() AT TIME ZONE 'UTC')::date
      `, [tgId]);
      return parseInt(res.rows[0]?.count || 0);
    } catch (err) {
      console.error('DBService.getDailyWithdrawalCount Error:', err);
      return 0;
    }
  }

  /**
   * Check if user has purchased a fast mining miner, deposited, or upgraded
   */
  async hasFastMiner(userId) {
    try {
      const tgId = Number(userId) || 9482103;
      const userRes = await db.query('SELECT total_deposited, deposit_balance, vip_tier FROM users WHERE telegram_id = $1', [tgId]);
      const user = userRes.rows[0];
      if (user && (parseFloat(user.total_deposited || 0) > 0 || (user.vip_tier && user.vip_tier !== 'Standard Tier'))) {
        return true;
      }

      const minerRes = await db.query('SELECT purchase_price, level, miner_id, name FROM active_miners WHERE user_id = $1', [tgId]);
      const miner = minerRes.rows[0];
      if (miner && (parseFloat(miner.purchase_price || 0) > 0 || parseInt(miner.level || 1) > 1 || (miner.miner_id && miner.miner_id !== 'starter' && miner.miner_id !== '100') || (miner.name && !miner.name.includes('Starter')))) {
        return true;
      }

      // Check if user has any miner upgrade or NFT purchase transaction
      const txRes = await db.query(`
        SELECT id FROM transactions 
        WHERE user_id = $1 AND (type ILIKE '%Upgrade%' OR type ILIKE '%Purchase%' OR type ILIKE '%Deposit NFT%') 
        LIMIT 1
      `, [tgId]);
      if (txRes.rows.length > 0) {
        return true;
      }

      return false;
    } catch (err) {
      console.error('DBService.hasFastMiner Error:', err);
      return false;
    }
  }

  /**
   * Claim a Mystery Gift Box with Starter, Milestone & Tiered Daily Boost rules:
   * - 1st Starter Box (for new users) = +0.0100 USDT / day (0.01$ added to daily rate)
   * - Milestone 10th, 20th, 30th, ... box = +0.0100 USDT / day (0.01$ added to daily rate)
   * - 2% Speed Boost = +0.0010 USDT / day
   * - 5% Speed Boost = +0.0020 USDT / day
   * - 20% Speed Boost = +0.0050 USDT / day (available when 20+ boxes opened)
   */
  async claimGiftBox(userId = 9482103, options = {}) {
    try {
      const tgId = Number(userId) || 9482103;
      const user = await this.getUser(tgId);

      const available = parseInt(user.giftBoxesAvailable !== undefined && user.giftBoxesAvailable !== null ? user.giftBoxesAvailable : 0);
      if (available <= 0) {
        throw new Error('No gift boxes available! Refer a friend to get +1 mystery gift box.');
      }

      const openedSoFar = parseInt(user.giftBoxesOpened || 0);
      const currentBoxNumber = openedSoFar + 1; // 1-based index of this opened box
      const isFirstBox = (openedSoFar === 0);
      const isMilestone = (!isFirstBox && currentBoxNumber % 10 === 0);

      let boostPercent = 2;
      let dailyAddAmount = 0.0010;
      let rewardTitle = '+2% Mining Speed Boost';
      let isMilestoneReward = false;
      let isStarterReward = false;

      if (isFirstBox) {
        // 1st Starter Box for new user -> 0.01$ daily reward
        isStarterReward = true;
        boostPercent = 50;
        dailyAddAmount = 0.0100;
        rewardTitle = '+0.01$ Starter Welcome Gift';
      } else if (isMilestone) {
        // 10th, 20th, 30th, 40th etc. Milestone Box -> 0.01$ daily reward
        isMilestoneReward = true;
        boostPercent = 50;
        dailyAddAmount = 0.0100;
        rewardTitle = `🎉 Mega Milestone Box #${currentBoxNumber} (+0.010$ Daily Boost)`;
      } else if (openedSoFar >= 20) {
        // When 20+ boxes opened, eligible for 20% (+0.005$), 5% (+0.002$), or 2% (+0.001$)
        const rolls = [
          { percent: 20, add: 0.0050 },
          { percent: 5,  add: 0.0020 },
          { percent: 2,  add: 0.0010 },
          { percent: 20, add: 0.0050 }
        ];
        const picked = rolls[Math.floor(Math.random() * rolls.length)];
        boostPercent = picked.percent;
        dailyAddAmount = picked.add;
        rewardTitle = `+${boostPercent}% Mining Speed Boost`;
      } else {
        // Normal boxes (2 to 9, etc.): 2% (+0.001$) or 5% (+0.002$)
        const rolls = [
          { percent: 2, add: 0.0010 },
          { percent: 2, add: 0.0010 },
          { percent: 5, add: 0.0020 },
          { percent: 5, add: 0.0020 },
          { percent: 2, add: 0.0010 }
        ];
        const picked = rolls[Math.floor(Math.random() * rolls.length)];
        boostPercent = picked.percent;
        dailyAddAmount = picked.add;
        rewardTitle = `+${boostPercent}% Mining Speed Boost`;
      }

      const giftType = options.giftType || 'USDT';

      // Calculate new mining rate by adding dailyAddAmount directly to mining rate
      const currentRate = parseFloat(user.miningRate || 0.0200);
      const newMiningRate = parseFloat((currentRate + dailyAddAmount).toFixed(6));
      const newAvailable = Math.max(0, available - 1);
      const newOpened = openedSoFar + 1;

      // Update user in Neon database
      const updateRes = await db.query(`
        UPDATE users
        SET gift_boxes_available = $1,
            gift_boxes_opened = $2,
            mining_rate = $3,
            daily_speed_bonus = COALESCE(daily_speed_bonus, 0) + $4,
            updated_at = NOW()
        WHERE telegram_id = $5
        RETURNING *;
      `, [newAvailable, newOpened, newMiningRate, dailyAddAmount, tgId]);

      // Update active miner daily reward as well
      try {
        await db.query(`
          UPDATE active_miners
          SET daily_reward = daily_reward + $1,
              updated_at = NOW()
          WHERE user_id = $2;
        `, [dailyAddAmount, tgId]);
      } catch (minerErr) {
        console.warn('Active miner boost update warning:', minerErr.message);
      }

      // Add transaction history record
      await this.addTransaction({
        id: `tx-gift-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId: tgId,
        type: isStarterReward 
          ? `Welcome Starter Gift (+0.010$/day)` 
          : (isMilestoneReward ? `Milestone Gift Box #${newOpened} (+0.010$/day)` : `Mystery Gift Box (+${boostPercent}% Speed Boost)`),
        amount: (isStarterReward || isMilestoneReward) ? `+0.010 USDT/day` : `+${boostPercent}% Boost`,
        status: 'Completed',
        positive: true,
        date: 'Just now'
      });

      const updatedUser = updateRes.rows.length > 0 ? this.formatUser(updateRes.rows[0]) : user;
      const updatedMiner = await this.getActiveMiner(tgId);

      return {
        success: true,
        message: isStarterReward 
          ? `🎉 Welcome Starter Box Claimed! +0.01$ Daily Mining Rate Added!` 
          : (isMilestoneReward ? `🎉 Milestone Box #${newOpened}! +0.01$ Daily Mining Rate Added!` : `⚡ Congratulations! +${boostPercent}% Mining Speed Boost Activated!`),
        speedBoost: boostPercent,
        dailyAddAmount: dailyAddAmount,
        rewardTitle,
        isFirstBox: isStarterReward,
        isMilestone: isMilestoneReward,
        boxNumber: newOpened,
        giftType,
        giftBoxesAvailable: newAvailable,
        giftBoxesOpened: newOpened,
        miningRate: newMiningRate,
        user: updatedUser,
        miner: updatedMiner
      };
    } catch (err) {
      console.error('DBService.claimGiftBox Error:', err);
      throw err;
    }
  }

  /**
   * Get list of purchased NFT miner plan IDs for a user
   */
  async getUserPurchasedNFTs(userId) {
    try {
      const tgId = Number(userId) || 9482103;
      const purchasedSet = new Set();

      // 1. Check user_purchased_miners table
      try {
        const res = await db.query('SELECT nft_id FROM user_purchased_miners WHERE user_id = $1', [tgId]);
        res.rows.forEach(r => {
          if (r.nft_id) {
            purchasedSet.add(r.nft_id);
            purchasedSet.add(r.nft_id.replace('nft-', ''));
            purchasedSet.add(`nft-${r.nft_id.replace('nft-', '')}`);
          }
        });
      } catch (tableErr) {
        // Table may be creating
      }

      // 2. Check active_miners table
      try {
        const activeRes = await db.query('SELECT miner_id, name, purchase_price FROM active_miners WHERE user_id = $1', [tgId]);
        const miner = activeRes.rows[0];
        if (miner && (parseFloat(miner.purchase_price || 0) > 0 || (miner.miner_id && miner.miner_id !== 'starter' && miner.miner_id !== '100') || (miner.name && !miner.name.includes('Starter')))) {
          const mId = miner.miner_id || '1024';
          purchasedSet.add(mId);
          purchasedSet.add(mId.replace('nft-', ''));
          purchasedSet.add(`nft-${mId.replace('nft-', '')}`);
        }
      } catch (minerErr) {}

      // 3. Check transactions history for any past NFT purchase
      try {
        const txRes = await db.query(`
          SELECT type FROM transactions 
          WHERE user_id = $1 AND type ILIKE 'Purchased %'
        `, [tgId]);
        txRes.rows.forEach(tx => {
          const t = tx.type || '';
          if (t.includes('1024') || t.includes('Cyber Bot')) {
            purchasedSet.add('nft-1024');
            purchasedSet.add('1024');
          } else if (t.includes('2048') || t.includes('Frostfang Wolf')) {
            purchasedSet.add('nft-2048');
            purchasedSet.add('2048');
          } else if (t.includes('4096') || t.includes('Cyber Panda')) {
            purchasedSet.add('nft-4096');
            purchasedSet.add('4096');
          } else if (t.includes('6666') || t.includes('Neon Neko')) {
            purchasedSet.add('nft-6666');
            purchasedSet.add('6666');
          } else if (t.includes('5555') || t.includes('Solar Phoenix')) {
            purchasedSet.add('nft-5555');
            purchasedSet.add('5555');
          } else if (t.includes('9999') || t.includes('Aurelius Lion')) {
            purchasedSet.add('nft-9999');
            purchasedSet.add('9999');
          }
        });
      } catch (txErr) {}

      return Array.from(purchasedSet);
    } catch (err) {
      console.error('DBService.getUserPurchasedNFTs Error:', err);
      return [];
    }
  }

  /**
   * Check if a specific NFT plan has already been purchased by the user
   */
  async isNFTAlreadyPurchased(userId, nftId) {
    try {
      if (!nftId) return false;
      const purchased = await this.getUserPurchasedNFTs(userId);
      const cleanId = String(nftId).replace('nft-', '');
      return purchased.includes(nftId) || purchased.includes(cleanId) || purchased.includes(`nft-${cleanId}`);
    } catch (err) {
      console.error('DBService.isNFTAlreadyPurchased Error:', err);
      return false;
    }
  }

  /**
   * Record a new NFT purchase in Neon Database
   */
  async recordNFTPurchase(userId, nft) {
    try {
      const tgId = Number(userId) || 9482103;
      const nftId = nft.id || `nft-${nft.miner_id || '1024'}`;
      const name = nft.name || 'Mining Plan';
      const price = parseFloat(nft.price || nft.purchase_price || 0);
      const dailyReward = parseFloat(nft.dailyReward || nft.daily_reward || 0.2000);

      await db.query(`
        INSERT INTO user_purchased_miners (user_id, nft_id, name, price, daily_reward)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, nft_id) DO NOTHING;
      `, [tgId, nftId, name, price, dailyReward]);

      return true;
    } catch (err) {
      console.error('DBService.recordNFTPurchase Error:', err);
      return false;
    }
  }

  /**
   * Get comprehensive system statistics for the Admin Bot Dashboard
   */
  async getAdminSystemStats() {
    try {
      // 1. Users overview & aggregated balances
      const userRes = await db.query(`
        SELECT 
          COUNT(*)::INT AS total_users,
          COUNT(*) FILTER (WHERE is_banned = TRUE)::INT AS banned_users,
          COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '24 HOURS')::INT AS active_24h,
          COALESCE(SUM(balance), 0)::NUMERIC AS total_balance,
          COALESCE(SUM(deposit_balance), 0)::NUMERIC AS total_deposit_balance,
          COALESCE(SUM(total_deposited), 0)::NUMERIC AS total_deposited,
          COALESCE(SUM(total_withdrawn), 0)::NUMERIC AS total_withdrawn
        FROM users;
      `);
      const u = userRes.rows[0] || {};

      // 2. Transactions stats (deposits, approved withdrawals, pending withdrawals)
      const txRes = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE type ILIKE 'Deposit%')::INT AS deposits_count,
          COUNT(*) FILTER (WHERE type ILIKE '%Withdraw%' AND (status = 'Completed' OR status = 'Success'))::INT AS withdrawals_completed_count,
          COUNT(*) FILTER (WHERE status = 'Pending')::INT AS withdrawals_pending_count,
          COALESCE(SUM(NULLIF(regexp_replace(amount, '[^0-9.]', '', 'g'), '')::NUMERIC) FILTER (WHERE type ILIKE 'Deposit%'), 0) AS deposits_amount,
          COALESCE(SUM(NULLIF(regexp_replace(amount, '[^0-9.]', '', 'g'), '')::NUMERIC) FILTER (WHERE type ILIKE '%Withdraw%' AND (status = 'Completed' OR status = 'Success')), 0) AS withdrawals_completed_amount,
          COALESCE(SUM(NULLIF(regexp_replace(amount, '[^0-9.]', '', 'g'), '')::NUMERIC) FILTER (WHERE status = 'Pending'), 0) AS withdrawals_pending_amount
        FROM transactions;
      `);
      const t = txRes.rows[0] || {};

      // 3. Miners and NFTs stats
      const minerRes = await db.query(`
        SELECT 
          COUNT(*)::INT AS total_active_miners,
          COALESCE(SUM(daily_reward), 0)::NUMERIC AS total_daily_mining_rate
        FROM active_miners
        WHERE status = 'Active';
      `);
      const m = minerRes.rows[0] || {};

      const purchasedPlansRes = await db.query(`
        SELECT COUNT(*)::INT AS total_purchased_plans
        FROM user_purchased_miners;
      `).catch(() => ({ rows: [{ total_purchased_plans: 0 }] }));
      const p = purchasedPlansRes.rows[0] || {};

      const totalMainBal = parseFloat(u.total_balance || 0);
      const totalDepBal = parseFloat(u.total_deposit_balance || 0);
      const totalUserFunds = parseFloat((totalMainBal + totalDepBal).toFixed(4));

      return {
        totalUsers: parseInt(u.total_users || 0),
        bannedUsers: parseInt(u.banned_users || 0),
        activeUsers24h: parseInt(u.active_24h || 0),
        totalUserBalance: totalMainBal.toFixed(4),
        totalDepositBalance: totalDepBal.toFixed(2),
        totalUserFunds: totalUserFunds.toFixed(4),
        totalDepositedAmount: parseFloat(u.total_deposited || t.deposits_amount || 0).toFixed(2),
        totalDepositsCount: parseInt(t.deposits_count || 0),
        totalWithdrawnAmount: parseFloat(u.total_withdrawn || t.withdrawals_completed_amount || 0).toFixed(4),
        totalWithdrawnCount: parseInt(t.withdrawals_completed_count || 0),
        pendingWithdrawalsCount: parseInt(t.withdrawals_pending_count || 0),
        pendingWithdrawalsAmount: parseFloat(t.withdrawals_pending_amount || 0).toFixed(4),
        totalActiveMiners: parseInt(m.total_active_miners || 0),
        totalPurchasedPlans: parseInt(p.total_purchased_plans || 0),
        totalDailyMiningRate: parseFloat(m.total_daily_mining_rate || 0).toFixed(4)
      };
    } catch (err) {
      console.error('DBService.getAdminSystemStats Error:', err);
      return {
        totalUsers: 0,
        bannedUsers: 0,
        activeUsers24h: 0,
        totalUserBalance: '0.0000',
        totalDepositBalance: '0.00',
        totalUserFunds: '0.0000',
        totalDepositedAmount: '0.00',
        totalDepositsCount: 0,
        totalWithdrawnAmount: '0.0000',
        totalWithdrawnCount: 0,
        pendingWithdrawalsCount: 0,
        pendingWithdrawalsAmount: '0.0000',
        totalActiveMiners: 0,
        totalPurchasedPlans: 0,
        totalDailyMiningRate: '0.0000'
      };
    }
  }
}

module.exports = new DBService();

