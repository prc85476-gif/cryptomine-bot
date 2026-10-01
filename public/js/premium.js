/**
 * Premium / VIP Module
 */
const PremiumModule = {
  init() {
    this.loadVIPPlans();
  },

  async loadVIPPlans() {
    const container = document.getElementById('vip-plans-container');
    if (!container) return;

    const res = await window.ApiService.getVIPPlans();
    if (res.success && res.plans) {
      window.appState.setState({ vipPlans: res.plans });
      this.renderVIPPlans(res.plans, res.currentTier, container);
    }
  },

  renderVIPPlans(plans, currentTier, container) {
    container.innerHTML = plans.map(plan => {
      const isCurrent = currentTier === plan.name;
      const recClass = plan.recommended ? 'recommended' : '';
      return `
        <div class="vip-plan-card ${recClass}">
          ${plan.recommended ? '<div class="vip-badge-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px; margin-right:3px;"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"></path></svg>BEST VALUE</div>' : ''}
          <div class="vip-plan-top">
            <div>
              <div class="vip-plan-name">${plan.name}</div>
              <div class="vip-plan-boost"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:3px;"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>${plan.multiplier}x Mining Speed (${plan.miningBoost})</div>
            </div>
            <div class="vip-plan-price-group">
              <span class="vip-plan-price">${plan.price}</span>
              <span class="vip-plan-duration">USDT / ${plan.duration}d</span>
            </div>
          </div>

          <ul class="vip-perks-list">
            ${plan.perks.map(perk => `
              <li class="vip-perk-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>${perk}</span>
              </li>
            `).join('')}
          </ul>

          <button class="btn-activate-vip" ${isCurrent ? 'disabled style="opacity:0.6; cursor:default;"' : ''} onclick="PremiumModule.activatePlan('${plan.id}', '${plan.name}', ${plan.price})">
            ${isCurrent ? 'Current Active Tier' : `Upgrade to ${plan.name} (${plan.price} USDT)`}
          </button>
        </div>
      `;
    }).join('');
  },

  async activatePlan(planId, name, price) {
    window.TelegramService.hapticImpact('heavy');
    const state = window.appState.getState();
    const numPrice = parseFloat(price) || 0;
    const depBal = parseFloat(state.depositBalance !== undefined ? state.depositBalance : (state.user?.depositBalance ?? state.user?.nftBalance ?? 0)) || 0;
    const mainBal = parseFloat(state.balance !== undefined ? state.balance : (state.user?.balance ?? 0)) || 0;
    const totalAvail = parseFloat((depBal + mainBal).toFixed(4));

    if (totalAvail < numPrice) {
      window.ModalManager.showToast(`Insufficient NFT balance! Need ${numPrice} USDT (Available: ${totalAvail.toFixed(2)} USDT). Please Top up.`, 'error');
      window.WalletModule ? window.WalletModule.openDepositPage() : window.ModalManager.openModal('modal-deposit');
      return;
    }

    if (confirm(`Confirm upgrade to ${name} for ${price} USDT?`)) {
      const res = await window.ApiService.activateVIP(planId);
      if (res.success) {
        window.TelegramService.hapticNotification('success');
        window.MiningModule.playSuccessSound();
        window.ModalManager.showToast(res.message, 'success');

        window.appState.setState({
          balance: res.newBalance,
          depositBalance: res.depositBalance,
          vipTier: res.vipTier
        });

        if (window.MiningModule && window.MiningModule.updateBalanceUI) {
          window.MiningModule.updateBalanceUI(res.newBalance, res.depositBalance);
        }
        this.loadVIPPlans();
      } else {
        window.TelegramService.hapticNotification('error');
        window.ModalManager.showToast(res.message, 'error');
      }
    }
  }
};

window.PremiumModule = PremiumModule;
