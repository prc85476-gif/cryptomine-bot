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
   * Get or create a user by Telegram ID
   */
  async getUser(telegramId = 9482103, meta = {}) {
    try {
      const tgId = Number(telegramId) || 9482103;
      const res = await db.query('SELECT * FROM users WHERE telegram_id = $1', [tgId]);

      // Resolve effective referrer if provided via direct ID or startParam/code
      let effectiveReferrerId = meta.referrerId ? Number(meta.referrerId) : null;
      if (!effectiveReferrerId && (meta.startParam || meta.referralCode)) {
        effectiveReferrerId = await this.findReferrerIdByCode(meta.startParam || meta.referralCode);
      }
      if (effectiveReferrerId && Number(effectiveReferrerId) === tgId) {
        effectiveReferrerId = null; // Cannot refer oneself
      }
      
      if (res.rows.length > 0) {
        // If user already exists in DB but doesn't have a referrer_id linked yet
        if (!res.rows[0].referrer_id && effectiveReferrerId) {
          await db.query('UPDATE users SET referrer_id = $1 WHERE telegram_id = $2', [effectiveReferrerId, tgId]);
          res.rows[0].referrer_id = effectiveReferrerId;

          await this.addReferral(effectiveReferrerId, {
            referredId: tgId,
            username: res.rows[0].username,
            firstName: res.rows[0].first_name,
            level: 1,
            commissionEarned: 0.00
          });

          try {
            const mainBotService = require('./mainBotService');
            if (mainBotService?.notifyReferrerNewUser) {
              mainBotService.notifyReferrerNewUser(effectiveReferrerId, res.rows[0].username, res.rows[0].first_name);
            }
          } catch (e) {}
        }

        // Optionally update profile details if new metadata provided
        if (meta.username || meta.firstName || meta.lastName || meta.avatar) {
          const updates = {};
          if (meta.username && meta.username !== res.rows[0].username) updates.username = meta.username;
          if (meta.firstName && meta.firstName !== res.rows[0].first_name) updates.first_name = meta.firstName;
          if (meta.lastName && meta.lastName !== res.rows[0].last_name) updates.last_name = meta.lastName;
          if (meta.avatar && meta.avatar !== res.rows[0].avatar) updates.avatar = meta.avatar;

          if (Object.keys(updates).length > 0) {
            return await this.updateUser(tgId, updates);
          }
        }
        return this.formatUser(res.rows[0]);
      }

      // Auto-create user if not exists in Neon Database
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
          referrer_id, vip_tier, vip_power_multiplier, wallet_address, avatar, is_banned
        ) VALUES (
          $1, $2, $3, $4,
          25.4867, 30.0000, 4.8200, 14.4630,
          12.0000, 0.0000, 0.0500, $5,
          $6, 'Standard Tier', 1.00, 'EQB...89xY (TON Space)', $7, false
        ) RETURNING *;
      `, [
        tgId,
        username,
        firstName,
        lastName,
        referralCode,
        effectiveReferrerId || null,
        avatar
      ]);

      // Initialize default active miner for this user
      await db.query(`
        INSERT INTO active_miners (
          user_id, miner_id, name, level, rarity, status,
          purchase_price, daily_reward, total_claim, total_reward, max_reward,
          mining_days, days_completed, power_hashrate, upgrade_cost,
          next_level, next_level_reward, next_level_hashrate, image, cycle_start_time
        ) VALUES (
          $1, '1024', 'Cyber Bot #1024', 1, 'Common', 'Active',
          1.0000, 0.0500, 0.0500, 0.0500, 1.5000,
          30, 0, '100 MH/s', 0.5000,
          2, 0.0750, '150 MH/s', '/assets/images/nft/miner-robot.png', $2
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

      // If registered with referrer, record referral link and notify referrer
      if (effectiveReferrerId && effectiveReferrerId !== tgId) {
        await this.addReferral(effectiveReferrerId, {
          referredId: tgId,
          username,
          firstName,
          level: 1,
          commissionEarned: 0.00
        });

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
      miningRate: parseFloat(row.mining_rate || 0.0500),
      referralCode: row.referral_code || 'CRYPTO-9482',
      referrerId: row.referrer_id,
      vipTier: row.vip_tier || 'Standard Tier',
      vipPowerMultiplier: parseFloat(row.vip_power_multiplier || 1.0),
      walletAddress: row.wallet_address || 'EQB...89xY (TON Space)',
      avatar: row.avatar || '/assets/images/nft/miner-robot.png',
      isBanned: row.is_banned === true,
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
        isBanned: 'is_banned'
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

      // Default miner if not present
      const newMiner = await db.query(`
        INSERT INTO active_miners (
          user_id, miner_id, name, level, rarity, status,
          purchase_price, daily_reward, total_claim, total_reward, max_reward,
          mining_days, days_completed, power_hashrate, upgrade_cost,
          next_level, next_level_reward, next_level_hashrate, image, cycle_start_time
        ) VALUES (
          $1, '1024', 'Cyber Bot #1024', 1, 'Common', 'Active',
          1.0000, 0.0500, 0.0500, 0.0500, 1.5000,
          30, 0, '100 MH/s', 0.5000,
          2, 0.0750, '150 MH/s', '/assets/images/nft/miner-robot.png', $2
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
      id: row.miner_id || '1024',
      name: row.name || 'Cyber Bot #1024',
      level: parseInt(row.level || 1),
      rarity: row.rarity || 'Common',
      status: row.status || 'Active',
      purchasePrice: parseFloat(row.purchase_price || 1.0),
      dailyReward: parseFloat(row.daily_reward || 0.0500),
      totalReward: parseFloat(row.total_reward || 0.0500),
      totalClaim: parseFloat(row.total_claim || 0.0500),
      maxReward: parseFloat(row.max_reward || 1.5000),
      miningDays: parseInt(row.mining_days || 30),
      daysCompleted: parseInt(row.days_completed || 0),
      powerHashrate: row.power_hashrate || '100 MH/s',
      upgradeCost: parseFloat(row.upgrade_cost || 0.50),
      nextLevel: parseInt(row.next_level || 2),
      nextLevelReward: parseFloat(row.next_level_reward || 0.0750),
      nextLevelHashrate: row.next_level_hashrate || '150 MH/s',
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
   * Distribute 3-Tier Referral Commissions (Tier 1: 10%, Tier 2: 5%, Tier 3: 2%)
   */
  async distributeReferralCommission(userId, sourceAmount, sourceAction = 'Activity') {
    try {
      const amt = parseFloat(sourceAmount);
      if (!amt || isNaN(amt) || amt <= 0) return;

      // 1. Get user and their direct referrer (Tier 1)
      const uRes = await db.query('SELECT telegram_id, username, first_name, referrer_id FROM users WHERE telegram_id = $1', [Number(userId)]);
      if (uRes.rows.length === 0 || !uRes.rows[0].referrer_id) return;

      const actor = uRes.rows[0];
      const tier1Id = actor.referrer_id;

      // Tier 1 Commission (10%)
      const comm1 = parseFloat((amt * 0.10).toFixed(4));
      if (comm1 > 0 && tier1Id) {
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

        // 2. Check Tier 2 Referrer (5%)
        const t1Res = await db.query('SELECT referrer_id FROM users WHERE telegram_id = $1', [tier1Id]);
        const tier2Id = t1Res.rows[0]?.referrer_id;

        if (tier2Id && tier2Id !== actor.telegram_id) {
          const comm2 = parseFloat((amt * 0.05).toFixed(4));
          if (comm2 > 0) {
            await db.query(`
              UPDATE users 
              SET balance = balance + $1, total_earned = total_earned + $1 
              WHERE telegram_id = $2;
            `, [comm2, tier2Id]);

            await this.addReferral(tier2Id, {
              referredId: actor.telegram_id,
              username: actor.username,
              firstName: actor.first_name,
              level: 2,
              commissionEarned: comm2
            });

            await this.addTransaction({
              id: `tx-ref2-${Date.now()}-${Math.floor(Math.random()*1000)}`,
              userId: tier2Id,
              type: `Referral Commission (Tier 2 - ${sourceAction})`,
              amount: `+${comm2.toFixed(4)} USDT`,
              txHash: `ref_t2_${actor.telegram_id}_${Date.now()}`,
              recipientAddress: actor.username ? `@${actor.username}` : `User #${actor.telegram_id}`,
              network: 'CryptoMine Network',
              status: 'Completed',
              positive: true,
              date: 'Just now'
            });

            try {
              const mainBotService = require('./mainBotService');
              if (mainBotService?.notifyReferrerCommission) {
                mainBotService.notifyReferrerCommission(tier2Id, comm2, 2, sourceAction);
              }
            } catch (e) {}

            // 3. Check Tier 3 Referrer (2%)
            const t2Res = await db.query('SELECT referrer_id FROM users WHERE telegram_id = $1', [tier2Id]);
            const tier3Id = t2Res.rows[0]?.referrer_id;

            if (tier3Id && tier3Id !== actor.telegram_id && tier3Id !== tier1Id) {
              const comm3 = parseFloat((amt * 0.02).toFixed(4));
              if (comm3 > 0) {
                await db.query(`
                  UPDATE users 
                  SET balance = balance + $1, total_earned = total_earned + $1 
                  WHERE telegram_id = $2;
                `, [comm3, tier3Id]);

                await this.addReferral(tier3Id, {
                  referredId: actor.telegram_id,
                  username: actor.username,
                  firstName: actor.first_name,
                  level: 3,
                  commissionEarned: comm3
                });

                await this.addTransaction({
                  id: `tx-ref3-${Date.now()}-${Math.floor(Math.random()*1000)}`,
                  userId: tier3Id,
                  type: `Referral Commission (Tier 3 - ${sourceAction})`,
                  amount: `+${comm3.toFixed(4)} USDT`,
                  txHash: `ref_t3_${actor.telegram_id}_${Date.now()}`,
                  recipientAddress: actor.username ? `@${actor.username}` : `User #${actor.telegram_id}`,
                  network: 'CryptoMine Network',
                  status: 'Completed',
                  positive: true,
                  date: 'Just now'
                });

                try {
                  const mainBotService = require('./mainBotService');
                  if (mainBotService?.notifyReferrerCommission) {
                    mainBotService.notifyReferrerCommission(tier3Id, comm3, 3, sourceAction);
                  }
                } catch (e) {}
              }
            }
          }
        }
      }
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
}

module.exports = new DBService();
