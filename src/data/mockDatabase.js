// Central in-memory database with reactive state for Telegram Mini App
const mockDatabase = {
  user: {
    id: 9482103,
    telegramId: "@cryptominer_pro",
    name: "Alex Miner",
    username: "@cryptominer_pro",
    avatar: "/assets/images/nft/miner-robot.png",
    depositBalance: 0.00, // Deposit / NFT Balance
    balance: 0.0000, // Total USDT Balance
    tonBalance: 0.00,
    miningRate: 0.0200, // USDT per day base rate (Free starter 0.02/day)
    totalEarned: 0.0000,
    totalWithdrawn: 0.0000,
    referralCode: "CRYPTO-9482",
    invitedCount: 0,
    referralEarnings: 0.0000,
    vipTier: "Standard Tier",
    vipPowerMultiplier: 1.0,
    joinedDate: "2026-08-15",
    walletAddress: null,
    isMiningActive: true,
    lastMinedTime: Date.now()
  },

  activeMiner: {
    id: "starter",
    name: "Free Starter Miner",
    level: 1,
    rarity: "Common",
    status: "Active",
    purchasePrice: 0.0,
    dailyReward: 0.0200,
    totalReward: 0.0000,
    totalClaim: 0.0000,
    maxReward: 0.2000,
    miningDays: 10, // 10-day duration (0.02$ / day)
    cycleHours: 24,
    cycleStartTime: Date.now(),
    powerHashrate: "50 MH/s",
    upgradeCost: 0.50,
    nextLevel: 2,
    nextLevelReward: 0.0500,
    nextLevelHashrate: "100 MH/s",
    image: "/assets/images/nft/miner-robot.png"
  },

  nftMarketplace: [
    {
      id: "nft-1024",
      name: "Cyber Bot #1024",
      description: "AI cyber miner with steady daily mining rewards.",
      rarity: "Common",
      rarityColor: "#8B5CF6",
      price: 2.0,
      currency: "USDT",
      dailyReward: 0.2000,
      totalReward: 6.0000,
      duration: 30,
      hashrate: "120 MH/s",
      roi: "300%",
      badge: "Popular",
      image: "/assets/images/nft/miner-robot.png",
      stock: 10000,
      sold: 2450
    },
    {
      id: "nft-2048",
      name: "Frostfang Wolf #2048",
      description: "Frost cyber miner with higher daily returns.",
      rarity: "Common",
      rarityColor: "#10B981",
      price: 5.0,
      currency: "USDT",
      dailyReward: 0.3000,
      totalReward: 9.0000,
      duration: 30,
      hashrate: "280 MH/s",
      roi: "180%",
      badge: "Frost Power",
      image: "/assets/images/nft/miner-wolf.png",
      stock: 650,
      sold: 1350
    },
    {
      id: "nft-4096",
      name: "Cyber Panda #4096",
      description: "Smart AI panda miner with steady daily income.",
      rarity: "Rare",
      rarityColor: "#06B6D4",
      price: 15.0,
      currency: "USDT",
      dailyReward: 0.7000,
      totalReward: 21.0000,
      duration: 30,
      hashrate: "650 MH/s",
      roi: "140%",
      badge: "Smart Miner",
      image: "/assets/images/nft/miner-panda.png",
      stock: 420,
      sold: 880
    },
    {
      id: "nft-6666",
      name: "Neon Neko #6666",
      description: "Agile neon cyber miner with boosted hashpower.",
      rarity: "Rare",
      rarityColor: "#10B981",
      price: 25.0,
      currency: "USDT",
      dailyReward: 2.0000,
      totalReward: 60.0000,
      duration: 30,
      hashrate: "1.40 GH/s",
      roi: "240%",
      badge: "Neon Turbo",
      image: "/assets/images/nft/miner-cat.png",
      stock: 310,
      sold: 620
    },
    {
      id: "nft-5555",
      name: "Solar Phoenix #5555",
      description: "High-capacity solar powerhouse for accelerated mining.",
      rarity: "Epic",
      rarityColor: "#EC4899",
      price: 50.0,
      currency: "USDT",
      dailyReward: 6.0000,
      totalReward: 180.0000,
      duration: 30,
      hashrate: "3.80 GH/s",
      roi: "360%",
      badge: "Sun Power",
      image: "/assets/images/nft/miner-phoenix.png",
      stock: 180,
      sold: 390
    },
    {
      id: "nft-9999",
      name: "Aurelius Lion #9999",
      description: "Supreme cosmic lion miner with massive daily yields.",
      rarity: "Epic",
      rarityColor: "#F59E0B",
      price: 100.0,
      currency: "USDT",
      dailyReward: 20.0000,
      totalReward: 600.0000,
      duration: 30,
      hashrate: "10.5 GH/s",
      roi: "600%",
      badge: "King Miner",
      image: "/assets/images/nft/miner-lion.png",
      stock: 90,
      sold: 210
    }
  ],

  vipPlans: [
    {
      id: "vip-bronze",
      name: "Bronze VIP",
      badge: "Starter Boost",
      price: 15.0,
      duration: 30,
      multiplier: 1.25,
      miningBoost: "+25% Hashrate",
      dailyReward: "+0.1500 USDT/day",
      perks: [
        "1.25x Mining Speed Multiplier",
        "5% Instant Cashback on NFT buys",
        "Priority Support Queue"
      ],
      color: "#CD7F32",
      recommended: false
    },
    {
      id: "vip-silver",
      name: "Silver VIP",
      badge: "Best Value",
      price: 45.0,
      duration: 60,
      multiplier: 1.75,
      miningBoost: "+75% Hashrate",
      dailyReward: "+0.6500 USDT/day",
      perks: [
        "1.75x Mining Speed Multiplier",
        "10% Instant Cashback on NFT buys",
        "0% Withdrawal Fee (Instant payout)",
        "Daily Lucky Spin Free Ticket"
      ],
      color: "#94A3B8",
      recommended: true
    },
    {
      id: "vip-gold",
      name: "Gold VIP",
      badge: "Pro Mining",
      price: 120.0,
      duration: 90,
      multiplier: 2.50,
      miningBoost: "+150% Hashrate",
      dailyReward: "+2.2000 USDT/day",
      perks: [
        "2.50x Mining Speed Multiplier",
        "15% Instant Cashback on NFT buys",
        "Zero gas fee withdrawals",
        "Exclusive Legendary NFT Whitelist",
        "Personal Telegram VIP Manager"
      ],
      color: "#F59E0B",
      recommended: false
    },
    {
      id: "vip-diamond",
      name: "Diamond VIP",
      badge: "Whale Tier",
      price: 350.0,
      duration: 180,
      multiplier: 4.00,
      miningBoost: "+300% Hashrate",
      dailyReward: "+7.5000 USDT/day",
      perks: [
        "4.00x Ultra Mining Speed Multiplier",
        "25% Instant Cashback on all NFT buys",
        "Automated Auto-Compound Mining",
        "Free Airdrop Allocation (Token TGE)",
        "Lifetime VIP Community Badge"
      ],
      color: "#06B6D4",
      recommended: false
    }
  ],

  streak: {
    currentDay: 3,
    lastCheckin: "2026-09-27",
    claimedToday: false,
    days: [
      { day: 1, reward: 0.10, label: "0.10 USDT", claimed: true },
      { day: 2, reward: 0.20, label: "0.20 USDT", claimed: true },
      { day: 3, reward: 0.50, label: "0.50 USDT", claimed: false, current: true },
      { day: 4, reward: 0.75, label: "0.75 USDT", claimed: false },
      { day: 5, reward: 1.00, label: "1.00 USDT", claimed: false },
      { day: 6, reward: 1.50, label: "1.50 USDT", claimed: false },
      { day: 7, reward: 3.00, label: "3.00 USDT + NFT Box", claimed: false, special: true }
    ]
  },

  tasks: [
    {
      id: "task-tg-channel",
      category: "Social",
      title: "Join CryptoMine Official Channel",
      reward: 0.50,
      currency: "USDT",
      icon: "send",
      status: "pending",
      link: "https://t.me/CryptoMineOfficial"
    },
    {
      id: "task-tg-group",
      category: "Social",
      title: "Join Telegram Global Chat",
      reward: 0.50,
      currency: "USDT",
      icon: "message-circle",
      status: "completed",
      link: "https://t.me/CryptoMineCommunity"
    },
    {
      id: "task-x-follow",
      category: "Social",
      title: "Follow CryptoMine on X (Twitter)",
      reward: 0.40,
      currency: "USDT",
      icon: "twitter",
      status: "pending",
      link: "https://x.com/CryptoMineTON"
    },
    {
      id: "task-boost-channel",
      category: "Special",
      title: "Boost our Telegram Channel",
      reward: 1.50,
      currency: "USDT",
      icon: "zap",
      status: "pending",
      link: "https://t.me/boost/CryptoMineOfficial"
    },
    {
      id: "task-invite-3",
      category: "Milestone",
      title: "Invite 3 Active Friends",
      reward: 2.00,
      currency: "USDT",
      icon: "users",
      status: "completed",
      progress: "8/3"
    },
    {
      id: "task-first-upgrade",
      category: "Milestone",
      title: "Upgrade Any Miner to Level 2+",
      reward: 1.00,
      currency: "USDT",
      icon: "arrow-up-circle",
      status: "completed",
      progress: "Done"
    }
  ],

  transactions: [],

  referrals: []
};

module.exports = mockDatabase;
