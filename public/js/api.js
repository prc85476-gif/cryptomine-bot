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

function getDeviceFingerprint() {
  try {
    let persistentId = localStorage.getItem('cm_dfp_v2');
    if (!persistentId) {
      const cookieMatch = document.cookie.match(/(?:^|; )cm_dfp_v2=([^;]*)/);
      if (cookieMatch) {
        persistentId = decodeURIComponent(cookieMatch[1]);
      } else {
        persistentId = 'fp_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      }
      try {
        localStorage.setItem('cm_dfp_v2', persistentId);
        document.cookie = `cm_dfp_v2=${encodeURIComponent(persistentId)}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (e) {}
    }

    // Hardware parameters
    const screenDetails = `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}x${window.devicePixelRatio || 1}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const platform = navigator.platform || '';
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;

    // Canvas fingerprinting
    let canvasHash = '0';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('CryptoMine#AntiMulti', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('CryptoMine#AntiMulti', 4, 17);
        const dataUrl = canvas.toDataURL();
        let hash = 0;
        for (let i = 0; i < dataUrl.length; i++) {
          hash = ((hash << 5) - hash) + dataUrl.charCodeAt(i);
          hash |= 0;
        }
        canvasHash = Math.abs(hash).toString(36);
      }
    } catch (ce) {}

    // WebGL renderer
    let glRenderer = '';
    try {
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          glRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        }
      }
    } catch (gle) {}

    // Composite signature hash
    const rawSig = `${persistentId}|${screenDetails}|${timezone}|${platform}|${cores}|${mem}|${canvasHash}|${glRenderer}`;
    let sigHash = 0;
    for (let j = 0; j < rawSig.length; j++) {
      sigHash = ((sigHash << 5) - sigHash) + rawSig.charCodeAt(j);
      sigHash |= 0;
    }

    return `${persistentId}_${Math.abs(sigHash).toString(36)}`;
  } catch (err) {
    return 'fp_fallback_' + (localStorage.getItem('cm_dfp_v2') || 'unknown');
  }
}

function getTelegramHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'x-device-fingerprint': getDeviceFingerprint()
  };
  try {
    const initData = window.Telegram?.WebApp?.initData || '';
    if (initData) {
      headers['x-telegram-init-data'] = initData;
    }
    const tgUser = window.TelegramService?.getUser ? window.TelegramService.getUser() : null;
    if (tgUser && tgUser.id) {
      headers['x-telegram-user-id'] = String(tgUser.id);
      if (tgUser.username) headers['x-telegram-username'] = safeHeader(tgUser.username);
      if (tgUser.first_name) headers['x-telegram-first-name'] = safeHeader(tgUser.first_name);
      if (tgUser.last_name) headers['x-telegram-last-name'] = safeHeader(tgUser.last_name);
      if (tgUser.photo_url) headers['x-telegram-avatar'] = safeHeader(tgUser.photo_url);
    }
    const startParam = window.TelegramService?.getStartParam ? window.TelegramService.getStartParam() : localStorage.getItem('cryptomine_referrer_param');
    if (startParam) {
      headers['x-telegram-start-param'] = safeHeader(startParam);
    }
  } catch (e) {}
  return headers;
}

function handleResponse(data) {
  if (data && (data.banned === true || data.error === 'ACCOUNT_BANNED')) {
    if (window.App && window.App.showBannedScreen) {
      window.App.showBannedScreen(data.message);
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
  claimGiftBox(data = {}) { return this.post('/user/claim-gift', data); },
  getGiftBoxInfo() { return this.get('/user/gift-info'); },

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
  createDepositIntent(amount, network) { return this.post('/wallet/deposit-intent', { amount, network }); },
  checkDepositStatus() { return this.get('/wallet/deposit-status'); },
  deposit(amount, network, txHash) { return this.post('/wallet/deposit', { amount, network, txHash }); },
  withdraw(amount, address, network, turnstileToken) { return this.post('/wallet/withdraw', { amount, address, network, turnstileToken }); },
  getReferralInfo() { return this.get('/wallet/referral'); }
};

window.ApiService = ApiService;
