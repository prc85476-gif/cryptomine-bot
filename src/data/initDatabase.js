const db = require('../config/db');

async function initDatabase() {
  try {
    console.log('🐘 Initializing Neon PostgreSQL Database Tables...');

    // 1. Users Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(100),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        balance NUMERIC(18, 4) DEFAULT 25.4867,
        deposit_balance NUMERIC(18, 4) DEFAULT 30.0000,
        ton_balance NUMERIC(18, 4) DEFAULT 4.8200,
        total_earned NUMERIC(18, 4) DEFAULT 14.4630,
        total_withdrawn NUMERIC(18, 4) DEFAULT 12.0000,
        total_deposited NUMERIC(18, 4) DEFAULT 0.0000,
        mining_rate NUMERIC(18, 4) DEFAULT 0.0500,
        referral_code VARCHAR(50) UNIQUE,
        referrer_id BIGINT,
        vip_tier VARCHAR(50) DEFAULT 'Standard Tier',
        vip_power_multiplier NUMERIC(5, 2) DEFAULT 1.00,
        wallet_address VARCHAR(255) DEFAULT 'EQB...89xY (TON Space)',
        avatar VARCHAR(500) DEFAULT '/assets/images/nft/miner-robot.png',
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Ensure is_banned column exists for existing tables
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
    `);

    // 2. Active Miners Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS active_miners (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        miner_id VARCHAR(50) NOT NULL DEFAULT '1024',
        name VARCHAR(100) NOT NULL DEFAULT 'Cyber Bot #1024',
        level INT DEFAULT 1,
        rarity VARCHAR(50) DEFAULT 'Common',
        status VARCHAR(50) DEFAULT 'Active',
        purchase_price NUMERIC(18, 4) DEFAULT 1.0000,
        daily_reward NUMERIC(18, 4) DEFAULT 0.0500,
        total_claim NUMERIC(18, 4) DEFAULT 0.0500,
        total_reward NUMERIC(18, 4) DEFAULT 0.0500,
        max_reward NUMERIC(18, 4) DEFAULT 1.5000,
        mining_days INT DEFAULT 30,
        days_completed INT DEFAULT 0,
        power_hashrate VARCHAR(50) DEFAULT '100 MH/s',
        upgrade_cost NUMERIC(18, 4) DEFAULT 0.5000,
        next_level INT DEFAULT 2,
        next_level_reward NUMERIC(18, 4) DEFAULT 0.0750,
        next_level_hashrate VARCHAR(50) DEFAULT '150 MH/s',
        image VARCHAR(500) DEFAULT '/assets/images/nft/miner-robot.png',
        cycle_start_time BIGINT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT unique_user_miner UNIQUE (user_id)
      );
    `);

    // 3. Transactions Table (Logs all deposits, TxIDs, withdrawals, claims, purchases)
    await db.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(100) PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        type VARCHAR(150) NOT NULL,
        amount VARCHAR(50) NOT NULL,
        tx_hash VARCHAR(255),
        recipient_address VARCHAR(255),
        network VARCHAR(50),
        status VARCHAR(50) DEFAULT 'Completed',
        positive BOOLEAN DEFAULT TRUE,
        date_str VARCHAR(50) DEFAULT 'Just now',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 4. Referrals Table (Refer tracking & stats)
    await db.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        referred_id BIGINT,
        username VARCHAR(100),
        first_name VARCHAR(100),
        level INT DEFAULT 1,
        commission_earned NUMERIC(18, 4) DEFAULT 0.0000,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT unique_referrer_referred UNIQUE (referrer_id, referred_id)
      );
    `);

    // Ensure no strict FK on referred_id so un-onboarded invited users can still be tracked
    await db.query(`
      ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referred_id_fkey;
    `);

    // 5. Streaks & Tasks Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS streaks_tasks (
        user_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
        streak_current_day INT DEFAULT 1,
        streak_claimed_today BOOLEAN DEFAULT FALSE,
        streak_last_claim_date VARCHAR(50),
        completed_task_ids TEXT[] DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Check if default test/admin user exists, if not seed initial record
    const userCheck = await db.query('SELECT * FROM users WHERE telegram_id = $1', [9482103]);
    if (userCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO users (
          telegram_id, username, first_name, last_name,
          balance, deposit_balance, ton_balance, total_earned,
          total_withdrawn, total_deposited, mining_rate, referral_code,
          vip_tier, vip_power_multiplier, wallet_address, avatar, is_banned
        ) VALUES (
          9482103, 'cryptominer_pro', 'Alex', 'Miner',
          25.4867, 30.0000, 4.8200, 14.4630,
          12.0000, 0.0000, 0.0500, 'CRYPTO-9482',
          'Standard Tier', 1.00, 'EQB...89xY (TON Space)', '/assets/images/nft/miner-robot.png', false
        );
      `);
    }

    // Fix sequence if needed
    await db.query(`
      SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));
    `);

    // Seed Active Miner if not exists
    const minerCheck = await db.query('SELECT * FROM active_miners WHERE user_id = $1', [9482103]);
    if (minerCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO active_miners (
          user_id, miner_id, name, level, rarity, status,
          purchase_price, daily_reward, total_claim, total_reward, max_reward,
          mining_days, days_completed, power_hashrate, upgrade_cost,
          next_level, next_level_reward, next_level_hashrate, image, cycle_start_time
        ) VALUES (
          9482103, '1024', 'Cyber Bot #1024', 1, 'Common', 'Active',
          1.0000, 0.0500, 0.0500, 0.0500, 1.5000,
          30, 0, '100 MH/s', 0.5000,
          2, 0.0750, '150 MH/s', '/assets/images/nft/miner-robot.png', $1
        );
      `, [Date.now()]);
    }

    // Seed Streaks/Tasks if not exists
    const streakCheck = await db.query('SELECT * FROM streaks_tasks WHERE user_id = $1', [9482103]);
    if (streakCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO streaks_tasks (
          user_id, streak_current_day, streak_claimed_today, streak_last_claim_date, completed_task_ids
        ) VALUES (
          9482103, 1, false, null, '{task-tg-sub,task-yt-sub}'
        );
      `);
    }

    // Seed Referrals if none exist
    const refCheck = await db.query('SELECT * FROM referrals WHERE referrer_id = $1', [9482103]);
    if (refCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO referrals (referrer_id, referred_id, username, first_name, level, commission_earned)
        VALUES
          (9482103, 89101, 'crypto_king99', 'David', 1, 2.5000),
          (9482103, 89102, 'elena_ton', 'Elena', 1, 1.8500),
          (9482103, 89103, 'sam_miner', 'Samir', 2, 1.2000),
          (9482103, 89104, 'john_btc', 'John', 2, 0.8000),
          (9482103, 89105, 'lisa_gem', 'Lisa', 3, 0.5000)
        ON CONFLICT DO NOTHING;
      `);
    }

    console.log('✅ Neon PostgreSQL Database Initialized & Seeded Successfully!');
    return true;
  } catch (err) {
    console.error('❌ Neon Database Initialization Error:', err);
    throw err;
  }
}

module.exports = initDatabase;
