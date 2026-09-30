/**
 * GiftBox Mystery Gifts Module
 * Full-Screen Sunburst + Glowing 3D Box + Lightning Burst + Custom Speed Booster Card
 * Dynamic Per-Referral Box System:
 * - 1 Claim = Consumes 1 box & Box disappears from page
 * - Per Refer = +1 Gift Box
 * - Clean percentage displays (+2%, +5%, +20%, Milestone Super Boost)
 * - Auto adds exact daily bonus in backend (+0.001$, +0.002$, +0.005$, +0.010$)
 */
const GiftBoxModule = {
  pendingSpeedBoost: 2,
  pendingGiftType: 'USDT',
  isMilestoneBox: false,
  activeCardEl: null,
  isClaiming: false,
  animationTimer: null,

  boxDefinitions: [
    { id: 'usdt', name: 'USDT Gift Box', type: 'USDT', img: '/assets/images/gifts/gift-usdt.png' },
    { id: 'sol', name: 'SOL Gift Box', type: 'SOL', img: '/assets/images/gifts/gift-sol.png' },
    { id: 'btc', name: 'BTC Gift Box', type: 'BTC', img: '/assets/images/gifts/gift-btc.png' },
    { id: 'crypto', name: 'Crypto Gift Box', type: 'CRYPTO', img: '/assets/images/gifts/gift-crypto.png' }
  ],

  init() {
    this.bindEvents();
    this.render();

    // Subscribe to state changes so whenever user data updates, giftbox UI syncs
    if (window.appState?.subscribe) {
      window.appState.subscribe((state) => {
        if (state.currentTab === 'giftbox') {
          this.render();
        }
      });
    }
  },

  bindEvents() {
    // Top Big Back Button to return to Home
    document.getElementById('btn-giftbox-back')?.addEventListener('click', () => {
      window.TelegramService?.hapticSelection();
      window.App.switchTab('home');
    });

    // Close Button on Top Left of Full-Screen Modal
    document.getElementById('btn-close-gift-modal')?.addEventListener('click', () => {
      window.TelegramService?.hapticImpact('light');
      this.closeModal();
    });

    // Tapping the glowing box speeds up the burst!
    document.getElementById('gift-modal-img')?.addEventListener('click', () => {
      this.triggerLightningBurst();
    });

    // Modal Claim Button
    document.getElementById('btn-claim-gift-reward')?.addEventListener('click', () => {
      this.handleClaimGift();
    });
  },

  getAvailableCount() {
    const user = window.appState?.getState().user;
    if (user && user.giftBoxesAvailable !== undefined && user.giftBoxesAvailable !== null) {
      return parseInt(user.giftBoxesAvailable);
    }
    return 0;
  },

  getOpenedCount() {
    const user = window.appState?.getState().user;
    return parseInt(user?.giftBoxesOpened || 0);
  },

  render() {
    const gridContainer = document.getElementById('giftbox-grid-container');
    const pillBadge = document.getElementById('giftbox-available-pill');
    const available = this.getAvailableCount();
    const opened = this.getOpenedCount();

    const giftSvgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5" rx="1"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>`;

    // 1. Update available pill in header
    if (pillBadge) {
      pillBadge.innerHTML = `${giftSvgIcon}Available: <strong>${available}</strong>`;
      pillBadge.className = `giftbox-available-badge ${available > 0 ? 'active' : 'empty'}`;
    }

    if (!gridContainer) return;

    // 2. Render Box Cards if Available > 0
    if (available > 0) {
      let html = '';

      for (let i = 0; i < available; i++) {
        const def = this.boxDefinitions[i % this.boxDefinitions.length];
        const nextBoxNum = opened + i + 1;
        const isStarter = (opened + i === 0);
        const isNextMilestone = (!isStarter && nextBoxNum % 10 === 0);

        let badgeTag = '';
        if (isStarter) {
          badgeTag = `
            <div class="giftbox-milestone-tag" style="background: linear-gradient(135deg, #10B981 0%, #059669 100%);">
              <span>${giftSvgIcon}Starter Gift (+0.01$)</span>
            </div>
          `;
        } else if (isNextMilestone) {
          badgeTag = `
            <div class="giftbox-milestone-tag">
              <span>⭐ Box #${nextBoxNum} (+0.01$)</span>
            </div>
          `;
        }

        html += `
          <div class="giftbox-card ${isNextMilestone ? 'milestone-box-card' : ''}" data-box-index="${i}" data-gift-id="${def.id}" data-gift-name="${def.name}" data-gift-type="${def.type}" role="button" tabindex="0" aria-label="Open ${def.name}">
            <div class="giftbox-card-glow-fx"></div>
            <img src="${def.img}" alt="${def.name}" class="giftbox-card-img" />
            
            ${badgeTag}

            <div class="giftbox-card-badge">
              <span class="giftbox-dot-pulse"></span>
              <span>Tap to Open</span>
            </div>
          </div>
        `;
      }
      gridContainer.innerHTML = html;
      gridContainer.className = 'giftbox-grid';

      // Attach click listeners to dynamically rendered cards
      gridContainer.querySelectorAll('.giftbox-card').forEach((card) => {
        card.addEventListener('click', () => {
          if (this.isClaiming) return;
          const giftId = card.dataset.giftId || 'usdt';
          const giftName = card.dataset.giftName || 'Gift Box';
          const giftType = card.dataset.giftType || 'USDT';
          this.activeCardEl = card;
          this.openGiftModal(giftId, giftName, giftType);
        });
      });
    } else {
      // 3. Render High-Conversion Empty State (+1 Box per Referral)
      const user = window.appState?.getState().user;
      const refCode = user?.referralCode || 'CRYPTO-9482';

      gridContainer.className = 'giftbox-grid empty-wrapper';
      gridContainer.innerHTML = `
        <div class="giftbox-empty-card">
          <h3 class="giftbox-empty-title">All Gift Boxes Claimed!</h3>
          <p class="giftbox-empty-desc">You have opened all your available gift boxes. Earn more mystery boxes by inviting your friends!</p>
          
          <div class="giftbox-perk-highlight">
            <div class="perk-pill">
              <span class="pulse-dot"></span>
              <span>Unlimited Rewards</span>
            </div>
            <div class="perk-title" style="display: flex; align-items: center; gap: 8px;">
              <span class="perk-gift-icon-badge" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: rgba(217, 119, 6, 0.15); color: #D97706; flex-shrink: 0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 12 20 22 4 22 4 12"></polyline>
                  <rect x="2" y="7" width="20" height="5" rx="1"></rect>
                  <line x1="12" y1="22" x2="12" y2="7"></line>
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
                </svg>
              </span>
              <span>Invite 1 Friend = Get +1 Mystery Gift Box</span>
            </div>
            <div class="perk-subtitle">Every referral instantly unlocks a new mystery box with speed boosts & rewards!</div>
          </div>

          <div class="giftbox-stats-strip">
            <div class="stat-mini">
              <span class="val">${opened}</span>
              <span class="lbl">Opened Boxes</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-mini">
              <span class="val text-amber">0</span>
              <span class="lbl">Available Boxes</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-mini">
              <span class="val text-emerald">+1 Box</span>
              <span class="lbl">Per Referral</span>
            </div>
          </div>

          <div class="giftbox-actions-row">
            <button class="btn-gift-invite-tg" onclick="GiftBoxModule.shareOnTelegram()">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
              <span>Invite Friends (+1 Box)</span>
            </button>
            <button class="btn-gift-copy-link" onclick="GiftBoxModule.copyReferralLink()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy Link</span>
            </button>
          </div>
        </div>
      `;
    }
  },

  openGiftModal(giftId, giftName, giftType) {
    this.clearTimers();

    window.TelegramService?.hapticImpact('medium');
    if (window.MiningModule && window.MiningModule.playClinkSound) {
      window.MiningModule.playClinkSound();
    }

    const modalEl = document.getElementById('modal-gift-reveal');
    const modalImg = document.getElementById('gift-modal-img');
    const stageIntro = document.getElementById('gift-stage-intro');
    const stageReward = document.getElementById('gift-stage-reward');
    const bottomWrap = document.getElementById('gift-reward-bottom-wrap');
    const badgeTextEl = document.getElementById('gift-power-badge-text');
    const congratsEl = document.getElementById('gift-reward-congrats');
    const wonTextEl = document.getElementById('gift-reward-won-text');
    const percentNumEl = document.getElementById('gift-boost-percent-num');
    const subLabelEl = document.getElementById('gift-boost-val-sub');
    const descTxtEl = document.getElementById('gift-boost-desc-txt');
    const claimBtn = document.getElementById('btn-claim-gift-reward');

    const openedSoFar = this.getOpenedCount();
    const currentBoxNumber = openedSoFar + 1;
    const isFirstBox = (openedSoFar === 0);
    const isMilestone = (!isFirstBox && currentBoxNumber % 10 === 0);

    this.isFirstBox = isFirstBox;
    this.isMilestoneBox = isMilestone;
    this.pendingGiftType = giftType;

    // Determine clean presentation
    if (isFirstBox) {
      // 1st Starter Box for new user -> 0.01$
      this.pendingSpeedBoost = 50;
      if (badgeTextEl) badgeTextEl.textContent = 'STARTER BONUS UNLOCKED';
      if (percentNumEl) percentNumEl.textContent = '+0.01$';
      if (subLabelEl) subLabelEl.textContent = 'Daily Mining Reward';
      if (descTxtEl) descTxtEl.textContent = 'Instant +0.01$ added directly to your daily active mining rate';
      if (congratsEl) congratsEl.textContent = 'Welcome Gift!';
      if (wonTextEl) wonTextEl.textContent = 'You unlocked +0.01$ Daily Mining Reward!';
      if (claimBtn) {
        claimBtn.disabled = false;
        claimBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FFE600" stroke="#B45309"></polygon>
          </svg>
          <span>Claim +0.01$/day Boost</span>
        `;
      }
    } else if (isMilestone) {
      // 10th, 20th, 30th etc. Milestone Box -> 0.01$
      this.pendingSpeedBoost = 50;
      if (badgeTextEl) badgeTextEl.textContent = '⭐ MILESTONE REWARD UNLOCKED';
      if (percentNumEl) percentNumEl.textContent = '+0.01$';
      if (subLabelEl) subLabelEl.textContent = 'Daily Mining Reward';
      if (descTxtEl) descTxtEl.textContent = 'Instant +0.01$ added directly to your daily active mining rate';
      if (congratsEl) congratsEl.textContent = `Milestone Box #${currentBoxNumber}!`;
      if (wonTextEl) wonTextEl.textContent = `🎉 Box #${currentBoxNumber} Milestone! You unlocked +0.01$ Daily Mining Reward!`;
      if (claimBtn) {
        claimBtn.disabled = false;
        claimBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FFE600" stroke="#B45309"></polygon>
          </svg>
          <span>Claim +0.01$/day Boost</span>
        `;
      }
    } else if (openedSoFar >= 20) {
      // 20+ boxes opened: eligible for 20%, 5%, or 2%
      const rolls = [20, 5, 2, 20];
      const picked = rolls[Math.floor(Math.random() * rolls.length)];
      this.pendingSpeedBoost = picked;
      if (badgeTextEl) badgeTextEl.textContent = 'SPEED MULTIPLIER UNLOCKED';
      if (percentNumEl) percentNumEl.textContent = `+${picked}%`;
      if (subLabelEl) subLabelEl.textContent = 'Mining Speed';
      if (descTxtEl) descTxtEl.textContent = 'Instant speed multiplier added to your active daily mining cycles';
      if (congratsEl) congratsEl.textContent = 'Congratulations!';
      if (wonTextEl) wonTextEl.textContent = `You unlocked +${picked}% mining speed boost!`;
      if (claimBtn) {
        claimBtn.disabled = false;
        claimBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FFE600" stroke="#B45309"></polygon>
          </svg>
          <span>Claim Speed Boost</span>
        `;
      }
    } else {
      // Standard boxes 2 to 9: 2% or 5%
      const rolls = [2, 2, 5, 5, 2];
      const picked = rolls[Math.floor(Math.random() * rolls.length)];
      this.pendingSpeedBoost = picked;
      if (badgeTextEl) badgeTextEl.textContent = 'SPEED MULTIPLIER UNLOCKED';
      if (percentNumEl) percentNumEl.textContent = `+${picked}%`;
      if (subLabelEl) subLabelEl.textContent = 'Mining Speed';
      if (descTxtEl) descTxtEl.textContent = 'Instant speed multiplier added to your active daily mining cycles';
      if (congratsEl) congratsEl.textContent = 'Congratulations!';
      if (wonTextEl) wonTextEl.textContent = `You unlocked +${picked}% mining speed boost!`;
      if (claimBtn) {
        claimBtn.disabled = false;
        claimBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#FFE600" stroke="#B45309"></polygon>
          </svg>
          <span>Claim Speed Boost</span>
        `;
      }
    }

    if (modalImg) {
      modalImg.src = `/assets/images/gifts/gift-${giftId}.png`;
      modalImg.classList.remove('shake');
    }

    // Set stage 1 (Intro Glowing Box) visible, stage 2 (Reward) hidden
    if (stageIntro) stageIntro.style.display = 'flex';
    if (stageReward) {
      stageReward.classList.remove('active');
      stageReward.style.display = 'none';
    }
    if (bottomWrap) bottomWrap.style.display = 'none';

    // Open Modal
    modalEl?.classList.add('active');

    // Suspense sequence
    this.animationTimer = setTimeout(() => {
      if (modalImg) modalImg.classList.add('shake');
      
      if (navigator.vibrate) {
        navigator.vibrate([60, 40, 100, 50, 140]);
      }
      window.TelegramService?.hapticImpact('medium');

      this.animationTimer = setTimeout(() => {
        this.triggerLightningBurst();
      }, 1100);
    }, 1100);
  },

  triggerLightningBurst() {
    this.clearTimers();

    const flashOverlay = document.getElementById('gift-lightning-flash');
    const boltEl = document.getElementById('gift-lightning-bolt');
    const stageIntro = document.getElementById('gift-stage-intro');
    const stageReward = document.getElementById('gift-stage-reward');
    const bottomWrap = document.getElementById('gift-reward-bottom-wrap');

    // Trigger Lightning Flash
    flashOverlay?.classList.add('flash');
    boltEl?.classList.add('active');

    if (navigator.vibrate) {
      navigator.vibrate([200, 50, 100]);
    }
    window.TelegramService?.hapticImpact('heavy');
    if (window.MiningModule && window.MiningModule.playSuccessSound) {
      window.MiningModule.playSuccessSound();
    }

    // Switch to Custom Stage 2
    if (stageIntro) stageIntro.style.display = 'none';
    if (stageReward) {
      stageReward.style.display = 'flex';
      stageReward.classList.add('active');
    }
    if (bottomWrap) bottomWrap.style.display = 'block';

    // Spawn confetti
    this.startConfetti();

    // Turn off flash after 160ms
    setTimeout(() => {
      flashOverlay?.classList.remove('flash');
      boltEl?.classList.remove('active');
    }, 160);
  },

  startConfetti() {
    const container = document.getElementById('gift-confetti-wrap');
    if (!container) return;
    container.innerHTML = '';

    const particleTemplates = [
      // 1. Golden Tether / Crypto Coin
      `<svg width="26" height="26" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" fill="#D97706" stroke="#FFE600" stroke-width="2"/>
        <circle cx="16" cy="16" r="10" stroke="#FFE600" stroke-width="1.2" stroke-dasharray="2 2"/>
        <text x="16" y="21" text-anchor="middle" font-size="14" font-weight="900" fill="#FFE600">₮</text>
      </svg>`,
      // 2. Neon Cyan Lightning
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#00F0FF" stroke="#FFFFFF" stroke-width="1.5"/>
      </svg>`,
      // 3. Purple/Blue Crypto Gem
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M6 3h12l4 6-10 12L2 9z" fill="#8B5CF6" stroke="#FFFFFF" stroke-width="1.4"/>
      </svg>`,
      // 4. Golden Star Sparkle
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="#FBBF24" stroke="#FFFFFF" stroke-width="1"/>
      </svg>`
    ];

    for (let i = 0; i < 28; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-item';
      el.innerHTML = particleTemplates[Math.floor(Math.random() * particleTemplates.length)];
      el.style.left = `${Math.random() * 94}%`;
      el.style.animationDuration = `${2.4 + Math.random() * 2.6}s`;
      el.style.animationDelay = `${Math.random() * 1.6}s`;
      container.appendChild(el);
    }
  },

  async handleClaimGift() {
    if (this.isClaiming) return;
    this.isClaiming = true;

    const claimBtn = document.getElementById('btn-claim-gift-reward');
    if (claimBtn) {
      claimBtn.disabled = true;
      claimBtn.innerHTML = `<span>Claiming Boost...</span>`;
    }

    try {
      const giftType = this.pendingGiftType || 'USDT';
      const boost = this.pendingSpeedBoost || 2;

      // Call Backend API to consume 1 box and persist speed boost & daily reward in DB
      const res = await window.ApiService.claimGiftBox({
        giftType,
        boostPercent: boost
      });

      if (res && res.success) {
        if (navigator.vibrate) {
          navigator.vibrate([80, 50, 120]);
        }
        window.TelegramService?.hapticNotification('success');
        if (window.MiningModule && window.MiningModule.playSuccessSound) {
          window.MiningModule.playSuccessSound();
        }

        // 1. Update Reactive App State
        if (window.appState && res.user) {
          window.appState.setState({
            user: res.user,
            balance: res.user.balance,
            miningRate: res.miningRate || res.user.miningRate,
            activeMiner: res.miner
          });

          // Sync Global UI
          window.App?.updateUserUI(res.user);
          if (res.miner) {
            window.App?.updateActiveMinerUI(res.miner);
          }
        }

        // 2. Animate out the claimed card immediately so it leaves the page
        if (this.activeCardEl) {
          this.activeCardEl.classList.add('claimed-exit');
        }

        let toastMsg = `⚡ Congratulations! +${res.speedBoost}% Mining Speed Boost Activated!`;
        if (res.isFirstBox) {
          toastMsg = `🎉 Welcome Starter Box Claimed! +0.01$ added to Daily Mining Reward!`;
        } else if (res.isMilestone) {
          toastMsg = `🎉 Milestone Box #${res.boxNumber}! +0.01$ added to Daily Mining Reward!`;
        }

        window.ModalManager.showToast(toastMsg, 'success');

        // 3. Close Modal & Re-render page
        this.closeModal();

        setTimeout(() => {
          this.render();
        }, 320);
      } else {
        window.TelegramService?.hapticNotification('error');
        window.ModalManager.showToast(res?.message || 'Could not claim gift box reward.', 'error');
        this.closeModal();
        this.render();
      }
    } catch (err) {
      console.error('Error in handleClaimGift:', err);
      window.ModalManager.showToast('Network error while claiming gift box.', 'error');
      this.closeModal();
      this.render();
    } finally {
      this.isClaiming = false;
      this.activeCardEl = null;
    }
  },

  closeModal() {
    this.clearTimers();
    const modalEl = document.getElementById('modal-gift-reveal');
    modalEl?.classList.remove('active');

    const confetti = document.getElementById('gift-confetti-wrap');
    if (confetti) confetti.innerHTML = '';
  },

  clearTimers() {
    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
  },

  shareOnTelegram() {
    if (window.ReferralModule?.shareOnTelegram) {
      window.ReferralModule.shareOnTelegram();
    } else {
      const user = window.appState?.getState().user;
      const refCode = user?.referralCode || 'CRYPTO-9482';
      const link = `https://t.me/cryptomintnftbot?start=${refCode}`;
      const msg = `🎁 Join CryptoMine and claim free USDT & mystery gifts!\n🚀 Use my invite link to get bonus mining power:\n${link}`;
      const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(msg)}`;
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(url);
      } else {
        window.open(url, '_blank');
      }
    }
  },

  copyReferralLink() {
    if (window.ReferralModule?.copyLink) {
      window.ReferralModule.copyLink();
    } else {
      const user = window.appState?.getState().user;
      const refCode = user?.referralCode || 'CRYPTO-9482';
      const link = `https://t.me/cryptomintnftbot?start=${refCode}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
          window.TelegramService?.hapticNotification('success');
          window.ModalManager.showToast('Referral link copied! Share with friends for +1 gift box each.', 'success');
        });
      }
    }
  }
};

window.GiftBoxModule = GiftBoxModule;
