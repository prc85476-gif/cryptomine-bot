/**
 * GiftBox Mystery Gifts Module
 */
const GiftBoxModule = {
  pendingReward: 0.0200,
  pendingGiftType: 'BTC',

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Top Big Back Button to return to Home
    document.getElementById('btn-giftbox-back')?.addEventListener('click', () => {
      window.TelegramService?.hapticSelection();
      window.App.switchTab('home');
    });

    // Gift Cards Click Listeners
    document.querySelectorAll('.giftbox-card').forEach(card => {
      card.addEventListener('click', () => {
        const giftId = card.dataset.giftId || 'btc';
        const giftName = card.dataset.giftName || 'BTC Gift Box';
        const giftType = card.dataset.giftType || 'BTC';
        this.openGiftModal(giftId, giftName, giftType);
      });
    });

    // Modal Claim Button
    document.getElementById('btn-claim-gift-reward')?.addEventListener('click', () => {
      this.handleClaimGift();
    });
  },

  openGiftModal(giftId, giftName, giftType) {
    window.TelegramService?.hapticImpact('medium');
    if (window.MiningModule && window.MiningModule.playClinkSound) {
      window.MiningModule.playClinkSound();
    }

    const modalTitle = document.getElementById('gift-modal-title');
    const modalImg = document.getElementById('gift-modal-img');
    const rewardValEl = document.getElementById('gift-reward-val');

    if (modalTitle) modalTitle.textContent = giftName || 'Mystery Gift Box';
    if (modalImg) modalImg.src = `/assets/images/gifts/gift-${giftId}.jpg`;

    // Generate delightful random reward amount
    const rewardOptions = [0.0100, 0.0150, 0.0200, 0.0250, 0.0300, 0.0500];
    const randAmt = rewardOptions[Math.floor(Math.random() * rewardOptions.length)];
    this.pendingReward = randAmt;
    this.pendingGiftType = giftType;

    if (rewardValEl) rewardValEl.textContent = `+${randAmt.toFixed(4)} USDT`;

    window.ModalManager.openModal('modal-gift-reveal');
  },

  async handleClaimGift() {
    window.TelegramService?.hapticNotification('success');
    if (window.MiningModule && window.MiningModule.playSuccessSound) {
      window.MiningModule.playSuccessSound();
    }

    const reward = this.pendingReward || 0.0200;
    const currentBalance = window.appState ? window.appState.getState().balance : 0;
    const newBal = parseFloat((currentBalance + reward).toFixed(4));

    if (window.appState) {
      window.appState.setState({ balance: newBal });
    }

    const elBal = document.getElementById('total-balance-val');
    if (elBal) elBal.textContent = newBal.toFixed(4);

    window.ModalManager.showToast(`🎉 Congratulations! You opened ${this.pendingGiftType} Gift and received +${reward.toFixed(4)} USDT!`, 'success');
    window.ModalManager.closeModal('modal-gift-reveal');
  }
};

window.GiftBoxModule = GiftBoxModule;
