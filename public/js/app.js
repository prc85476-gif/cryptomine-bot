/**
 * CryptoMine Main Application Coordinator
 */
const App = {
  async init() {
    console.log('💎 Initializing CryptoMine Telegram Mini App...');
    
    // 1. Initialize Theme (Default White / Light)
    this.initTheme();

    // 2. Initialize Telegram WebApp SDK
    window.TelegramService.init();

    // 3. Initialize Modals
    window.ModalManager.init();

    // 4. Bind Bottom Navigation & Quick Action Routing
    this.bindNavigation();
    this.bindQuickActions();
    this.bindUpgradeModalAction();

    // 5. Fetch Initial State from Backend
    await this.fetchInitialData();

    // 6. Initialize Sub-modules
    window.MiningModule.init();
    window.NFTModule.init();
    window.PremiumModule.init();
    window.TasksModule.init();
    window.ReferralModule?.init();
    window.WalletModule.init();
    window.LiveWithdrawalPopup?.init();

    console.log('✅ CryptoMine UI ready!');
  },

  initTheme() {
    // Default to white/light theme ("backgrount wait koro")
    const savedTheme = localStorage.getItem('cryptomine_theme') || 'light';
    this.applyTheme(savedTheme);

    const toggleBtn = document.getElementById('header-theme-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'light' ? 'dark' : 'light';
        this.applyTheme(next);
        localStorage.setItem('cryptomine_theme', next);
        window.TelegramService.hapticSelection();
        window.ModalManager.showToast(`Theme switched to ${next === 'light' ? 'White / Light' : 'Dark'} mode`, 'info');
      });
    }
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');

    if (theme === 'dark') {
      if (sunIcon) sunIcon.style.display = 'block';
      if (moonIcon) moonIcon.style.display = 'none';
      if (window.TelegramService?.tg?.setHeaderColor) {
        window.TelegramService.tg.setHeaderColor('#080d1e');
      }
    } else {
      if (sunIcon) sunIcon.style.display = 'none';
      if (moonIcon) moonIcon.style.display = 'block';
      if (window.TelegramService?.tg?.setHeaderColor) {
        window.TelegramService.tg.setHeaderColor('#FFFFFF');
      }
    }
  },

  async fetchInitialData() {
    try {
      const [userRes, minerRes] = await Promise.all([
        window.ApiService.getUserProfile(),
        window.ApiService.getActiveMiner()
      ]);

      if (userRes.banned === true || userRes.data?.isBanned === true) {
        this.showBannedScreen();
        return;
      }

      if (userRes.success && userRes.data) {
        window.appState.setState({
          user: userRes.data,
          balance: userRes.data.balance,
          miningRate: userRes.data.miningRate
        });
        this.updateUserUI(userRes.data);
      }

      if (minerRes.success && minerRes.data) {
        window.appState.setState({
          activeMiner: minerRes.data.miner
        });
        this.updateActiveMinerUI(minerRes.data.miner);
      }
    } catch (err) {
      console.error('Error fetching initial data:', err);
    }
  },

  showBannedScreen() {
    document.body.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #060914; color: #fff; padding: 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="width: 80px; height: 80px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); border: 2px solid #ef4444; display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 20px;">
          🚫
        </div>
        <h2 style="font-size: 22px; font-weight: 700; color: #ef4444; margin-bottom: 10px;">Account Suspended</h2>
        <p style="font-size: 14px; color: #94a3b8; max-width: 320px; line-height: 1.6; margin-bottom: 24px;">
          Your account has been restricted by the administrator. You are not allowed to access the Mini App or perform transactions.
        </p>
        <div style="background: rgba(255,255,255,0.05); padding: 14px 20px; border-radius: 12px; font-size: 13px; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);">
          If you believe this is an error, please contact Telegram Support.
        </div>
      </div>
    `;
  },

  bindNavigation() {
    const navItems = document.querySelectorAll('.bottom-nav .nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Header Support bot button (@CryptoMint_Support_bot)
    const supportBtn = document.getElementById('header-support-btn');
    if (supportBtn) {
      supportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.TelegramService.hapticImpact('light');
        window.TelegramService.openTelegram('https://t.me/CryptoMint_Support_bot');
      });
    }

    // Header Telegram Channel button (https://t.me/cryptomintwithdraw)
    const telegramBtn = document.getElementById('header-telegram-btn');
    if (telegramBtn) {
      telegramBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.TelegramService.hapticImpact('light');
        window.TelegramService.openTelegram('https://t.me/cryptomintwithdraw');
      });
    }

    // Profile icon in header
    const profileBtn = document.getElementById('header-profile-btn');
    if (profileBtn) {
      profileBtn.addEventListener('click', () => {
        this.switchTab('profile');
      });
    }

    // Notification bell in header
    const notifBtn = document.getElementById('header-notification-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => {
        window.ModalManager.openModal('modal-notifications');
      });
    }
  },

  switchTab(tabName) {
    window.TelegramService.hapticSelection();
    
    // Toggle header visibility (hide header on profile page)
    const appHeader = document.querySelector('.app-header');
    if (appHeader) {
      appHeader.style.display = (tabName === 'profile') ? 'none' : 'flex';
    }

    // Update active nav button
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Show active tab view
    document.querySelectorAll('.tab-page').forEach(page => {
      page.classList.toggle('active', page.id === `tab-${tabName}`);
    });

    window.appState.setState({ currentTab: tabName });

    // Refresh sub-views when navigating
    if (tabName === 'nft') {
      window.NFTModule.loadNFTs(window.NFTModule.currentRarity);
    } else if (tabName === 'premium') {
      window.PremiumModule.loadVIPPlans();
    } else if (tabName === 'tasks') {
      window.TasksModule.loadTasks();
    } else if (tabName === 'referral') {
      window.ReferralModule?.loadReferralData();
    } else if (tabName === 'profile') {
      window.WalletModule.loadProfileWalletStats();
    }

    // Scroll to top of content
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;
  },

  bindQuickActions() {
    // Deposit Quick Card
    document.getElementById('quick-deposit')?.addEventListener('click', () => {
      window.TelegramService.hapticSelection();
      window.WalletModule ? window.WalletModule.openDepositPage() : window.ModalManager.openModal('modal-deposit');
    });

    // Withdraw Quick Card
    document.getElementById('quick-withdraw')?.addEventListener('click', () => {
      window.WalletModule ? window.WalletModule.openWithdrawPage() : window.ModalManager.openModal('modal-withdraw');
    });

    // Referral Quick Card -> Switch to Referral tab
    document.getElementById('quick-referral')?.addEventListener('click', () => {
      this.switchTab('referral');
    });

    // NFT Shop Quick Card
    document.getElementById('quick-nft-shop')?.addEventListener('click', () => {
      this.switchTab('nft');
    });

    // Premium Quick Card
    document.getElementById('quick-premium')?.addEventListener('click', () => {
      this.switchTab('premium');
    });

    // Tasks Quick Card
    document.getElementById('quick-tasks')?.addEventListener('click', () => {
      this.switchTab('tasks');
    });

    // Go Premium / Promo Banner Buttons -> Switch to Referral tab
    document.getElementById('btn-home-invite-banner')?.addEventListener('click', () => {
      window.TelegramService.hapticSelection();
      this.switchTab('referral');
    });

    document.getElementById('btn-vip-banner-upgrade')?.addEventListener('click', () => {
      this.switchTab('premium');
    });

    // Balance Card Withdraw Button
    document.getElementById('btn-balance-card-withdraw')?.addEventListener('click', () => {
      window.TelegramService.hapticSelection();
      window.WalletModule ? window.WalletModule.openWithdrawPage() : window.ModalManager.openModal('modal-withdraw');
    });

    // Profile Action Cards: Add Fund & Withdraw
    document.getElementById('profile-quick-deposit')?.addEventListener('click', () => {
      window.TelegramService.hapticSelection();
      window.WalletModule ? window.WalletModule.openDepositPage() : window.ModalManager.openModal('modal-deposit');
    });

    document.getElementById('profile-quick-withdraw')?.addEventListener('click', () => {
      window.TelegramService.hapticSelection();
      window.WalletModule ? window.WalletModule.openWithdrawPage() : window.ModalManager.openModal('modal-withdraw');
    });

    // Profile UID Copy Button
    document.getElementById('profile-uid-copy-btn')?.addEventListener('click', () => {
      const uidVal = document.getElementById('profile-tg-uid-val')?.textContent || '9482103';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(uidVal).then(() => {
          window.TelegramService.hapticNotification('success');
          window.ModalManager.showToast(`UID: ${uidVal} copied to clipboard!`, 'success');
        }).catch(() => {
          window.TelegramService.hapticNotification('success');
          window.ModalManager.showToast(`UID: ${uidVal}`, 'info');
        });
      } else {
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast(`UID: ${uidVal}`, 'info');
      }
    });
  },

  bindUpgradeModalAction() {
    const confirmUpgradeBtn = document.getElementById('btn-confirm-miner-upgrade');
    if (confirmUpgradeBtn) {
      confirmUpgradeBtn.addEventListener('click', async () => {
        window.TelegramService.hapticImpact('heavy');
        const res = await window.ApiService.upgradeMiner();
        if (res.success) {
          window.TelegramService.hapticNotification('success');
          window.MiningModule.playSuccessSound();
          window.ModalManager.showToast(res.message, 'success');

          window.appState.setState({
            balance: res.newBalance,
            depositBalance: res.depositBalance,
            miningRate: res.miningRate,
            activeMiner: res.activeMiner
          });

          this.updateActiveMinerUI(res.activeMiner);
          if (window.MiningModule && window.MiningModule.updateBalanceUI) {
            window.MiningModule.updateBalanceUI(res.newBalance, res.depositBalance);
          }
          window.ModalManager.closeModal('modal-upgrade');
        } else {
          window.TelegramService.hapticNotification('error');
          window.ModalManager.showToast(res.message, 'error');
          if (res.message.includes('Insufficient')) {
            window.ModalManager.closeModal('modal-upgrade');
            window.WalletModule ? window.WalletModule.openDepositPage() : window.ModalManager.openModal('modal-deposit');
          }
        }
      });
    }
  },

  updateUserUI(user) {
    const elBal = document.getElementById('total-balance-val');
    const elNftBal = document.getElementById('nft-balance-val');
    const elRate = document.getElementById('mining-rate-val');
    const elUser = document.getElementById('header-username');
    const elProfName = document.getElementById('profile-fullname-val');
    const elProfUser = document.getElementById('profile-username-val');
    const elTgUid = document.getElementById('profile-tg-uid-val');
    const elWallet = document.getElementById('profile-wallet-addr');
    const elProfTier = document.getElementById('profile-vip-tier-badge');
    const elAvatar = document.getElementById('profile-avatar-img');
    const elHeaderAvatar = document.querySelector('.profile-avatar-inner img');

    // Detect Telegram User data if running inside Telegram WebApp
    const tgUser = window.TelegramService?.getUser();
    const displayName = (tgUser?.first_name ? `${tgUser.first_name}${tgUser.last_name ? ' ' + tgUser.last_name : ''}` : null) || user.name || "Alex Miner";
    const username = (tgUser?.username ? `@${tgUser.username}` : null) || (user.telegramId || (user.username?.startsWith('@') ? user.username : `@${user.username || 'cryptominer_pro'}`));
    const uid = tgUser?.id || user.id || "9482103";
    const avatarUrl = tgUser?.photo_url || user.avatar || "/assets/images/nft/miner-robot.png";

    if (elBal) elBal.textContent = Number(user.balance).toFixed(4);
    if (elNftBal) elNftBal.textContent = Number(user.depositBalance ?? user.nftBalance ?? 30.00).toFixed(2);
    if (elRate) elRate.textContent = `+${Number(user.miningRate).toFixed(4)} USDT/hr`;
    if (elUser) elUser.textContent = displayName;
    if (elProfName) elProfName.textContent = displayName;
    if (elProfUser) elProfUser.textContent = username;
    if (elTgUid) elTgUid.textContent = uid;
    if (elWallet) elWallet.textContent = user.walletAddress || "EQB...89xY (TON Space)";
    if (elProfTier) elProfTier.textContent = user.vipTier || "Standard Tier";
    if (elAvatar) elAvatar.src = avatarUrl;
    if (elHeaderAvatar) elHeaderAvatar.src = avatarUrl;
  },

  updateActiveMinerUI(miner) {
    if (!miner) return;

    const elName = document.getElementById('miner-name-val');
    const elRarity = document.getElementById('miner-rarity-badge');
    const elDaily = document.getElementById('miner-daily-reward');
    const elTotal = document.getElementById('miner-total-reward');
    const elDays = document.getElementById('miner-days-val');
    const elLevel = document.getElementById('miner-level-badge');
    const elImg = document.getElementById('miner-avatar-img');

    if (elName) elName.textContent = miner.name;
    if (elRarity) {
      elRarity.textContent = miner.rarity;
      elRarity.className = `badge badge-${miner.rarity.toLowerCase()}`;
    }
    if (elDaily) elDaily.textContent = `${Number(miner.dailyReward).toFixed(4)} USDT`;
    if (elTotal) elTotal.textContent = `${Number(miner.totalClaim || miner.totalReward).toFixed(4)} USDT`;
    if (elDays) elDays.textContent = `24 Hours`;
    if (elLevel) elLevel.textContent = `Level ${miner.level}`;
    if (elImg) elImg.src = miner.image;

    const elRate = document.getElementById('mining-rate-val');
    if (elRate) elRate.textContent = `+${Number(miner.dailyReward).toFixed(4)} USDT/d`;

    if (window.MiningModule) {
      if (miner.cycleStartTime) {
        window.MiningModule.setCycleStartTime(miner.cycleStartTime);
      } else {
        window.MiningModule.updateCycleDisplay();
      }
    }

    // Update Upgrade Modal Preview
    const upCurLv = document.getElementById('upgrade-current-level');
    const upNextLv = document.getElementById('upgrade-next-level');
    const upCurDaily = document.getElementById('upgrade-current-daily');
    const upNextDaily = document.getElementById('upgrade-next-daily');
    const upCurHash = document.getElementById('upgrade-current-hash');
    const upNextHash = document.getElementById('upgrade-next-hash');
    const upCost = document.getElementById('upgrade-cost-val');

    if (upCurLv) upCurLv.textContent = `Level ${miner.level}`;
    if (upNextLv) upNextLv.textContent = `Level ${miner.nextLevel}`;
    if (upCurDaily) upCurDaily.textContent = `${miner.dailyReward} USDT/d`;
    if (upNextDaily) upNextDaily.textContent = `${miner.nextLevelReward} USDT/d`;
    if (upCurHash) upCurHash.textContent = miner.powerHashrate;
    if (upNextHash) upNextHash.textContent = miner.nextLevelHashrate;
    if (upCost) upCost.textContent = `${miner.upgradeCost} USDT`;
  }
};

window.App = App;

// Bootstrap on DOM Loaded
document.addEventListener('DOMContentLoaded', () => {
  window.App.init();
});
