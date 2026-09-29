/**
 * Frontend API Service for CryptoMine Backend connected to Neon Database
 */
const API_BASE = '/api';

function safeHeader(val) {
  if (!val) return '';
  try {
    return encodeURIComponent(String(val));
  } catch (e) {
    return '';
  }
}

function getTelegramHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  try {
    const tgUser = window.TelegramService?.getUser ? window.TelegramService.getUser() : null;
    if (tgUser && tgUser.id) {
      headers['x-telegram-user-id'] = String(tgUser.id);
      if (tgUser.username) headers['x-telegram-username'] = safeHeader(tgUser.username);
      if (tgUser.first_name) headers['x-telegram-first-name'] = safeHeader(tgUser.first_name);
      if (tgUser.last_name) headers['x-telegram-last-name'] = safeHeader(tgUser.last_name);
      if (tgUser.photo_url) headers['x-telegram-avatar'] = safeHeader(tgUser.photo_url);
    }
  } catch (e) {}
  return headers;
}

function handleResponse(data) {
  if (data && (data.banned === true || data.error === 'ACCOUNT_BANNED')) {
    if (window.App && window.App.showBannedScreen) {
      window.App.showBannedScreen();
    }
  }
  return data;
}

const ApiService = {
  async get(endpoint) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: getTelegramHeaders()
      });
      const data = await res.json();
      return handleResponse(data);
    } catch (err) {
      console.error(`API GET error on ${endpoint}:`, err);
      return { success: false, error: err.message };
    }
  },

  async post(endpoint, data = {}) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: getTelegramHeaders(),
        body: JSON.stringify(data)
      });
      const resData = await res.json();
      return handleResponse(resData);
    } catch (err) {
      console.error(`API POST error on ${endpoint}:`, err);
      return { success: false, error: err.message };
    }
  },

  // User
  getUserProfile() { return this.get('/user/profile'); },
  updateSettings(data) { return this.post('/user/settings', data); },

  // Miner
  getActiveMiner() { return this.get('/miner/active'); },
  mineNow(data = {}) { return this.post('/miner/mine', data); },
  upgradeMiner() { return this.post('/miner/upgrade'); },
  fastForwardMining() { return this.post('/miner/fast-forward'); },

  // NFT Marketplace
  getNFTs(rarity = 'all') { return this.get(`/nft/list?rarity=${rarity}`); },
  buyNFT(nftId) { return this.post('/nft/buy', { nftId }); },

  // Premium / VIP
  getVIPPlans() { return this.get('/premium/plans'); },
  activateVIP(planId) { return this.post('/premium/activate', { planId }); },

  // Tasks & Streak
  getTasks() { return this.get('/tasks/list'); },
  claimStreak() { return this.post('/tasks/claim-streak'); },
  claimTask(taskId) { return this.post('/tasks/claim-task', { taskId }); },

  // Wallet
  getWalletDetails() { return this.get('/wallet/details'); },
  deposit(amount, network, txHash) { return this.post('/wallet/deposit', { amount, network, txHash }); },
  withdraw(amount, address, network, turnstileToken) { return this.post('/wallet/withdraw', { amount, address, network, turnstileToken }); },
  getReferralInfo() { return this.get('/wallet/referral'); }
};

window.ApiService = ApiService;
