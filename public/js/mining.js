/**
 * Mining Module: 24-Hour Cycle Timer, English Top Popup Notifications, Audio & Claim System
 */
const MiningModule = {
  cycleInterval: null,
  audioCtx: null,
  cycleStartTime: Date.now(),
  CYCLE_DURATION_MS: 24 * 3600 * 1000, // 24 Hours

  init() {
    this.bindEvents();
    this.startCycleLoop();
  },

  setCycleStartTime(startTime) {
    if (startTime) {
      this.cycleStartTime = Number(startTime);
    }
    this.updateCycleDisplay();
  },

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  },

  playClinkSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(3200, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch (e) {}
  },

  playSuccessSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      
      const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.07);

        gain.gain.setValueAtTime(0.15, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.22);
      });
    } catch (e) {}
  },

  startCycleLoop() {
    if (this.cycleInterval) clearInterval(this.cycleInterval);
    this.updateCycleDisplay();

    // Check & update timer and real-time mined counter smoothly
    this.cycleInterval = setInterval(() => {
      this.updateCycleDisplay();
    }, 80);
  },

  // Dynamic Mining Easing Curve: Faster initial progress for high visual responsiveness,
  // then steady linear growth that converges exactly to 100% (dailyReward) at 24 hours.
  getProgressionRatio(elapsedMs) {
    if (elapsedMs >= this.CYCLE_DURATION_MS) return 1.0;
    if (elapsedMs <= 0) return 0.0;
    const t = elapsedMs / this.CYCLE_DURATION_MS;
    // 70% linear + 30% square-root curve gives fast initial movement in 1-2 hours
    const boostedRatio = (0.7 * t) + (0.3 * Math.sqrt(t));
    return Math.min(1.0, Math.max(0.0, boostedRatio));
  },

  updateCycleDisplay() {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.cycleStartTime);
    const isFull = elapsedMs >= this.CYCLE_DURATION_MS;
    const ratio = this.getProgressionRatio(elapsedMs);
    const progressPct = isFull ? 100 : Math.min(100, ratio * 100);

    const state = window.appState ? window.appState.getState() : {};
    const dailyReward = (state.activeMiner && state.activeMiner.dailyReward) ? Number(state.activeMiner.dailyReward) : 0.0200;

    // 1. Progress Text & Bar Line (Fills up towards 24h with faster initial speed)
    const elapsedHours = Math.floor(elapsedMs / (3600 * 1000));
    const elapsedMins = Math.floor((elapsedMs % (3600 * 1000)) / (60 * 1000));
    const progressText = isFull 
      ? `24h 00m / 24 Hours` 
      : `${elapsedHours}h ${String(elapsedMins).padStart(2, '0')}m / 24 Hours`;

    const elProgTxt = document.getElementById('miner-progress-text');
    const elProgFill = document.getElementById('miner-progress-fill');
    if (elProgTxt) elProgTxt.textContent = progressText;
    if (elProgFill) elProgFill.style.width = `${progressPct.toFixed(2)}%`;

    // 2. Real-time Live Mining Amount on Claim Button Subtitle
    const claimBtn = document.getElementById('btn-mine-now');
    const claimSubtitle = document.getElementById('claim-btn-pending-val');
    
    if (claimSubtitle) {
      if (isFull) {
        claimSubtitle.textContent = `+${dailyReward.toFixed(4)} USDT Ready to Claim`;
      } else {
        const currentMined = ratio * dailyReward;
        claimSubtitle.textContent = `+${currentMined.toFixed(6)} USDT Mining`;
      }
    }

    if (claimBtn) {
      if (isFull) {
        claimBtn.classList.add('claim-ready');
      } else {
        claimBtn.classList.remove('claim-ready');
      }
    }
  },

  bindEvents() {
    const mineBtn = document.getElementById('btn-mine-now');
    if (mineBtn) {
      mineBtn.addEventListener('click', (e) => this.handleMineClick(e));
    }

    const upgradeBtn = document.getElementById('btn-upgrade-power');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        window.TelegramService.hapticImpact('light');
        window.ModalManager.openModal('modal-upgrade');
      });
    }
  },

  async handleMineClick(e) {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.cycleStartTime);
    const isFull = elapsedMs >= this.CYCLE_DURATION_MS;
    const remainingMs = Math.max(0, this.CYCLE_DURATION_MS - elapsedMs);

    const state = window.appState ? window.appState.getState() : {};
    const dailyReward = (state.activeMiner && state.activeMiner.dailyReward) ? state.activeMiner.dailyReward : 0.0200;

    // CASE 1: Cycle NOT FULL -> Show Small Top Popup Toast (English only, no big modal)
    if (!isFull) {
      window.TelegramService.hapticImpact('medium');
      this.playClinkSound();

      // Card micro-shake
      const minerCard = document.querySelector('.nft-miner-card');
      if (minerCard) {
        minerCard.classList.remove('mine-active-shake');
        void minerCard.offsetWidth;
        minerCard.classList.add('mine-active-shake');
      }

      const remHours = Math.floor(remainingMs / (3600 * 1000));
      const remMins = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
      const timeStr = remHours > 0 ? `${remHours}h ${remMins}m` : `${remMins}m`;

      if (window.ModalManager && window.ModalManager.showToast) {
        window.ModalManager.showToast(`⏳ Mining in progress! Reward claimable in ${timeStr} (+${Number(dailyReward).toFixed(4)} USDT)`, 'warning');
      }
      return;
    }

    // CASE 2: Cycle FULL -> Claim Daily Mining Reward!
    window.TelegramService.hapticImpact('heavy');
    this.playSuccessSound();

    const claimBtn = document.getElementById('btn-mine-now');
    if (claimBtn) {
      claimBtn.classList.remove('claim-ready');
    }

    // Call Backend to claim
    const res = await window.ApiService.mineNow();
    if (res.success && res.canClaim) {
      window.appState.setState({
        balance: res.newBalance,
        activeMiner: res.activeMiner
      });

      // Update Top Balance Card UI
      const balanceValEl = document.getElementById('total-balance-val');
      if (balanceValEl) {
        balanceValEl.textContent = Number(res.newBalance).toFixed(4);
      }

      // Update Total Claim stat
      const totalRewardEl = document.getElementById('miner-total-reward');
      if (totalRewardEl) {
        totalRewardEl.textContent = `${Number(res.totalClaim || res.totalReward).toFixed(4)} USDT`;
      }

      // Reset cycle timer to start next 24-hour cycle
      this.cycleStartTime = res.cycleStartTime || Date.now();
      this.updateCycleDisplay();

      // Spawn floating sparkles
      const x = e ? (e.clientX || window.innerWidth / 2) : window.innerWidth / 2;
      const y = e ? (e.clientY || window.innerHeight / 2) : window.innerHeight / 2;
      this.spawnFloatingSparkle(x, y, `+${Number(res.reward).toFixed(4)} USDT Claimed!`);

      // Small top success toast
      if (window.ModalManager && window.ModalManager.showToast) {
        window.ModalManager.showToast(`🎉 Successfully claimed +${Number(res.reward).toFixed(4)} USDT!`, 'success');
      }
    } else {
      const remHours = Math.floor(remainingMs / (3600 * 1000));
      const remMins = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
      const timeStr = remHours > 0 ? `${remHours}h ${remMins}m` : `${remMins}m`;

      if (window.ModalManager && window.ModalManager.showToast) {
        window.ModalManager.showToast(`⏳ Mining in progress! Reward claimable in ${timeStr}`, 'warning');
      }
    }
  },

  updateBalanceUI(newBalance, newDepositBalance) {
    if (newBalance !== undefined && newBalance !== null) {
      const balanceValEl = document.getElementById('total-balance-val');
      if (balanceValEl) {
        balanceValEl.textContent = Number(newBalance).toFixed(4);
      }
      const availBalEl = document.getElementById('withdraw-avail-bal');
      if (availBalEl) {
        availBalEl.textContent = `${Number(newBalance).toFixed(4)} USDT`;
      }
    }
    if (newDepositBalance !== undefined && newDepositBalance !== null) {
      const elNftBal = document.getElementById('nft-balance-val');
      if (elNftBal) {
        elNftBal.textContent = Number(newDepositBalance).toFixed(2);
      }
    }
  },

  spawnFloatingSparkle(x, y, text) {
    const el = document.createElement('div');
    el.className = 'floating-sparkle';
    el.textContent = `💎 ${text}`;
    el.style.left = `${x - 60}px`;
    el.style.top = `${y - 30}px`;
    document.body.appendChild(el);

    setTimeout(() => {
      el.remove();
    }, 1400);
  }
};

window.MiningModule = MiningModule;
