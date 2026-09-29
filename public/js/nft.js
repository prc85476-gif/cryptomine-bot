/**
 * NFT Marketplace Module
 */
const NFTModule = {
  currentRarity: 'all',

  init() {
    this.bindFilterEvents();
    this.loadNFTs();
  },

  bindFilterEvents() {
    const chips = document.querySelectorAll('.nft-filter-bar .filter-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        window.TelegramService.hapticSelection();
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentRarity = chip.dataset.rarity || 'all';
        this.loadNFTs(this.currentRarity);
      });
    });
  },

  async loadNFTs(rarity = 'all') {
    const container = document.getElementById('nft-marketplace-list');
    if (!container) return;

    container.innerHTML = '<div class="skeleton" style="height: 180px; margin-bottom: 12px; border-radius: 20px;"></div><div class="skeleton" style="height: 180px; border-radius: 20px;"></div>';

    const res = await window.ApiService.getNFTs(rarity);
    if (res.success && res.data) {
      window.appState.setState({ nfts: res.data });
      this.renderNFTList(res.data, container);
    }
  },

  renderNFTList(nfts, container) {
    if (nfts.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px; font-weight: 600;">No NFT miners found in this category.</div>';
      return;
    }

    container.innerHTML = nfts.map(nft => {
      const rarityLower = (nft.rarity || 'common').toLowerCase();
      const rarityClass = `rarity-tag-${rarityLower}`;
      const desc = nft.description || 'Advanced AI miner with high stability.';

      return `
        <div class="nft-market-card">
          <!-- Top Main Row: Avatar + Info + 3 Stat Badges -->
          <div class="nft-card-main">
            <div class="nft-avatar-box">
              <img src="${nft.image}" alt="${nft.name}" loading="lazy" />
            </div>

            <div class="nft-info-col">
              <!-- Name & Rarity Pill -->
              <div class="nft-title-row">
                <h3 class="nft-title">${nft.name}</h3>
                <span class="rarity-tag ${rarityClass}">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                  </svg>
                  ${nft.rarity.toUpperCase()}
                </span>
              </div>

              <!-- Description -->
              <p class="nft-desc">${desc}</p>

              <!-- 3 Horizontal Stat Badges -->
              <div class="nft-stat-badges">
                <!-- Daily -->
                <div class="stat-badge daily">
                  <div class="badge-label-line">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                      <polyline points="17 6 23 6 23 12"></polyline>
                    </svg>
                    <span>Daily Reward</span>
                  </div>
                  <span class="badge-val-txt">+${Number(nft.dailyReward).toFixed(4)} USDT</span>
                </div>

                <!-- Total -->
                <div class="stat-badge total">
                  <div class="badge-label-line">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span>Total Reward</span>
                  </div>
                  <span class="badge-val-txt">${nft.totalReward} USDT</span>
                </div>

                <!-- Duration -->
                <div class="stat-badge duration">
                  <div class="badge-label-line">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>Duration</span>
                  </div>
                  <span class="badge-val-txt">${nft.duration} Days</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Row: Price with Tether USDT Circle + Capsule Buy Button -->
          <div class="nft-card-bottom">
            <div class="nft-price-wrapper">
              <div class="usdt-logo-circle">
                <img src="/assets/images/usdt-logo.avif" alt="USDT" class="usdt-circle-img" />
              </div>
              <div class="nft-price-details">
                <span class="price-subtitle">Price</span>
                <span class="price-val-main">${nft.price} <span class="currency-unit">USDT</span></span>
              </div>
            </div>

            <button class="btn-nft-buy-capsule" onclick="NFTModule.confirmBuyNFT('${nft.id}', '${nft.name}', ${nft.price})">
              <svg class="bolt-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
              </svg>
              <span>Buy Now</span>
              <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  confirmBuyNFT(id, name, price) {
    window.TelegramService.hapticImpact('medium');
    const state = window.appState.getState();
    const nftBal = state.depositBalance ?? 30.00;
    const totalAvail = (state.depositBalance || 0) + (state.balance || 0);

    if (totalAvail < price) {
      window.ModalManager.showToast(`Insufficient NFT balance! You need ${price} USDT. Please Top up.`, 'error');
      window.WalletModule ? window.WalletModule.openDepositPage() : window.ModalManager.openModal('modal-deposit');
      return;
    }

    // Modal confirm buy
    const modal = document.getElementById('modal-buy-nft');
    if (modal) {
      document.getElementById('buy-nft-name').textContent = name;
      document.getElementById('buy-nft-price').textContent = `${price} USDT`;
      document.getElementById('btn-confirm-buy-nft').dataset.nftId = id;
      window.ModalManager.openModal('modal-buy-nft');
    } else {
      this.executeBuy(id, name, price);
    }
  },

  async executeBuy(id, name, price) {
    window.TelegramService.hapticImpact('heavy');
    const res = await window.ApiService.buyNFT(id);
    if (res.success && res.activeMiner) {
      window.appState.setState({
        balance: res.newBalance,
        depositBalance: res.depositBalance,
        activeMiner: res.activeMiner
      });

      if (window.MiningModule && window.MiningModule.updateBalanceUI) {
        window.MiningModule.updateBalanceUI(res.newBalance, res.depositBalance);
      }

      // Update Active Miner UI on Home Tab
      if (window.App && window.App.updateActiveMinerUI) {
        window.App.updateActiveMinerUI(res.activeMiner);
      }

      // Start 24h Cycle Timer immediately for new miner
      if (window.MiningModule) {
        window.MiningModule.setCycleStartTime(res.activeMiner.cycleStartTime || Date.now());
      }

      // Switch to Home tab to show active mining
      if (window.App && window.App.switchTab) {
        window.App.switchTab('home');
      }

      window.ModalManager.showToast(`🎉 Deployed ${name}! 24h mining cycle started.`, 'success');
    } else {
      window.ModalManager.showToast(res.message || 'Purchase failed', 'error');
    }
  }
};

window.NFTModule = NFTModule;
