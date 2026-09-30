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
        balance NUMERIC(18, 4) DEFAULT 0.0000,
        deposit_balance NUMERIC(18, 4) DEFAULT 0.0000,
        ton_balance NUMERIC(18, 4) DEFAULT 0.0000,
        total_earned NUMERIC(18, 4) DEFAULT 0.0000,
        total_withdrawn NUMERIC(18, 4) DEFAULT 0.0000,
        total_deposited NUMERIC(18, 4) DEFAULT 0.0000,
        mining_rate NUMERIC(18, 4) DEFAULT 0.0200,
        referral_code VARCHAR(50) UNIQUE,
        referrer_id BIGINT,
        vip_tier VARCHAR(50) DEFAULT 'Standard Tier',
        vip_power_multiplier NUMERIC(5, 2) DEFAULT 1.00,
        wallet_address VARCHAR(255) DEFAULT NULL,
        avatar VARCHAR(500) DEFAULT '/assets/images/nft/miner-robot.png',
        is_banned BOOLEAN DEFAULT FALSE,
        ban_reason VARCHAR(255) DEFAULT NULL,
        device_fingerprint VARCHAR(255) DEFAULT NULL,
        last_ip VARCHAR(100) DEFAULT NULL,
        user_agent VARCHAR(500) DEFAULT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Clean legacy dummy placeholder wallet addresses if any exist
    await db.query(`
      UPDATE users SET wallet_address = NULL 
      WHERE wallet_address LIKE '%EQB...%' OR wallet_address LIKE '%TON Space%';
    `).catch(() => {});

    // Ensure is_banned & anti-abuse device/IP columns exist with 0 initial values
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(255) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip VARCHAR(100) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_boxes_available INT DEFAULT 1;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_boxes_opened INT DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_speed_bonus NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE users ALTER COLUMN balance SET DEFAULT 0.0000;
      ALTER TABLE users ALTER COLUMN deposit_balance SET DEFAULT 0.0000;
      ALTER TABLE users ALTER COLUMN ton_balance SET DEFAULT 0.0000;
      ALTER TABLE users ALTER COLUMN total_earned SET DEFAULT 0.0000;
      ALTER TABLE users ALTER COLUMN total_withdrawn SET DEFAULT 0.0000;
      ALTER TABLE users ALTER COLUMN total_deposited SET DEFAULT 0.0000;
    `).catch(() => {});

    // 2. Active Miners Table (Free Starter Miner: 0.02 USDT/day for 10 days = 0.20 USDT total)
    await db.query(`
      CREATE TABLE IF NOT EXISTS active_miners (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        miner_id VARCHAR(50) NOT NULL DEFAULT 'starter',
        name VARCHAR(100) NOT NULL DEFAULT 'Free Starter Miner',
        level INT DEFAULT 1,
        rarity VARCHAR(50) DEFAULT 'Common',
        status VARCHAR(50) DEFAULT 'Active',
        purchase_price NUMERIC(18, 4) DEFAULT 0.0000,
        daily_reward NUMERIC(18, 4) DEFAULT 0.0200,
        total_claim NUMERIC(18, 4) DEFAULT 0.0000,
        total_reward NUMERIC(18, 4) DEFAULT 0.0000,
        max_reward NUMERIC(18, 4) DEFAULT 0.2000,
        mining_days INT DEFAULT 10,
        days_completed INT DEFAULT 0,
        power_hashrate VARCHAR(50) DEFAULT '50 MH/s',
        upgrade_cost NUMERIC(18, 4) DEFAULT 0.5000,
        next_level INT DEFAULT 2,
        next_level_reward NUMERIC(18, 4) DEFAULT 0.0500,
        next_level_hashrate VARCHAR(50) DEFAULT '100 MH/s',
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
    `).catch(() => {});

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

    // 6. User Purchased Miners Table (Tracks purchased NFT miners/plans to prevent duplicate purchases)
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_purchased_miners (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
        nft_id VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(18, 4) NOT NULL,
        daily_reward NUMERIC(18, 4) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT unique_user_nft UNIQUE (user_id, nft_id)
      );
    `);

    console.log('✅ Neon PostgreSQL Database Initialized Successfully with 0 Balances!');
    return true;
  } catch (err) {
    console.error('❌ Neon Database Initialization Error:', err);
    throw err;
  }
}

module.exports = initDatabase;
