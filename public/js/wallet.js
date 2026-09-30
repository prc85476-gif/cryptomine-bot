/**
 * Wallet, Transactions and Referral Module
 */
const WalletModule = {
  currentDepositNetwork: 'USDT BEP20',
  currentDepositAmount: 1,
  currentExactAmount: '1.0000',
  depositAddress: '0x91AbcbAbE89945De4e491bf8850Bae836dB66547',
  currentWithdrawNetwork: 'USDT BEP20',
  savedWalletAddress: null,
  hasFastMiner: false,
  depositPollInterval: null,

  init() {
    this.bindEvents();
    this.bindDepositEvents();
    this.bindWithdrawEvents();
  },

  bindEvents() {
    // Copy Referral Link
    const copyRefBtn = document.getElementById('btn-copy-referral-link');
    if (copyRefBtn) {
      copyRefBtn.addEventListener('click', () => {
        const link = document.getElementById('referral-link-input').value;
        navigator.clipboard.writeText(link);
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast('Referral link copied to clipboard!', 'success');
      });
    }

    // Share Referral Link on Telegram
    const shareRefBtn = document.getElementById('btn-share-referral-tg');
    if (shareRefBtn) {
      shareRefBtn.addEventListener('click', () => {
        const link = document.getElementById('referral-link-input').value;
        const msg = encodeURIComponent(`⛏️ Join CryptoMine with me and earn daily USDT crypto rewards with NFT Miners!\n${link}`);
        const tgShareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${msg}`;
        if (window.Telegram?.WebApp?.openTelegramLink) {
          window.Telegram.WebApp.openTelegramLink(tgShareUrl);
        } else {
          window.open(tgShareUrl, '_blank');
        }
      });
    }
  },

  openDepositPage() {
    this.stopDepositPolling();

    // Reset steps
    const step1 = document.getElementById('deposit-step-1');
    const step2 = document.getElementById('deposit-step-2');
    if (step1) {
      step1.classList.add('active');
      step1.style.display = 'flex';
    }
    if (step2) {
      step2.classList.remove('active');
      step2.style.display = 'none';
    }

    // Reset Live Status Card in Step 2 to waiting state
    const liveCard = document.getElementById('deposit-live-status-card');
    const liveTitle = document.getElementById('deposit-status-title');
    const liveDesc = document.getElementById('deposit-status-desc');
    const liveBadge = document.getElementById('deposit-live-badge');
    if (liveCard) liveCard.classList.remove('confirmed');
    if (liveTitle) liveTitle.textContent = 'Waiting for transfer';
    if (liveDesc) liveDesc.textContent = 'We check incoming payments automatically';
    if (liveBadge) liveBadge.innerHTML = '<span class="live-dot"></span><span>LIVE</span>';

    // Reset error state
    const amtCard = document.getElementById('deposit-amount-card');
    const errEl = document.getElementById('deposit-amount-error');
    if (amtCard) amtCard.classList.remove('input-error');
    if (errEl) errEl.style.display = 'none';

    // Default amount 1 USDT
    this.currentDepositAmount = this.currentDepositAmount >= 1 ? this.currentDepositAmount : 1;
    const amtInput = document.getElementById('topup-amount-input');
    if (amtInput) {
      amtInput.value = this.currentDepositAmount || '1';
    }

    // Preset pills highlight
    document.querySelectorAll('.preset-pill').forEach(pill => {
      if (pill.dataset.amt === String(this.currentDepositAmount)) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // Default network USDT BEP20
    this.currentDepositNetwork = 'USDT BEP20';
    this.depositAddress = '0x91AbcbAbE89945De4e491bf8850Bae836dB66547';
    const netCards = document.querySelectorAll('#deposit-networks-grid .withdraw-net-card');
    netCards.forEach(c => {
      if (c.dataset.network === 'USDT BEP20') c.classList.add('active');
      else c.classList.remove('active');
    });

    window.ModalManager.openModal('modal-deposit');
  },

  startDepositPolling() {
    this.stopDepositPolling();
    this.depositPollInterval = setInterval(async () => {
      // Only poll if modal-deposit is currently open and visible
      const modalDep = document.getElementById('modal-deposit');
      if (!modalDep || !modalDep.classList.contains('active')) {
        this.stopDepositPolling();
        return;
      }

      try {
        const res = await window.ApiService.checkDepositStatus();
        if (res && res.confirmed === true) {
          this.handleDepositConfirmed(res);
        }
      } catch (err) {
        console.warn('Deposit status polling error:', err);
      }
    }, 2000); // Check every 2 seconds for ultra fast response
  },

  stopDepositPolling() {
    if (this.depositPollInterval) {
      clearInterval(this.depositPollInterval);
      this.depositPollInterval = null;
    }
  },

  handleDepositConfirmed(res) {
    this.stopDepositPolling();

    // 1. Trigger celebratory audio & haptic feedback
    window.TelegramService.hapticNotification('success');
    if (window.MiningModule && window.MiningModule.playSuccessSound) {
      window.MiningModule.playSuccessSound();
    }

    // 2. Transform Step 2 status card and verify button to glowing green confirmed state
    const liveCard = document.getElementById('deposit-live-status-card');
    const liveTitle = document.getElementById('deposit-status-title');
    const liveDesc = document.getElementById('deposit-status-desc');
    const liveBadge = document.getElementById('deposit-live-badge');
    const verifyBtn = document.getElementById('btn-verify-deposit');
    const verifyTextEl = document.getElementById('btn-verify-deposit-text');

    const creditAmt = res.baseAmount || this.currentDepositAmount;
    if (liveCard) liveCard.classList.add('confirmed');
    if (liveTitle) liveTitle.textContent = '🎉 Payment Confirmed & Added!';
    if (liveDesc) liveDesc.textContent = `+${parseFloat(creditAmt).toFixed(2)} USDT credited to your balance.`;
    if (liveBadge) liveBadge.innerHTML = '<span class="live-dot"></span><span>CREDITED</span>';

    if (verifyBtn) {
      verifyBtn.classList.add('btn-verified-success');
      verifyBtn.disabled = true;
    }
    if (verifyTextEl) {
      verifyTextEl.innerHTML = `<span>✅ Verified & Credited (+${parseFloat(creditAmt).toFixed(2)} USDT)</span>`;
    }

    // 3. Update app state & UI immediately
    const newDepBal = res.depositBalance !== undefined ? res.depositBalance : 0;
    const newBal = res.newBalance !== undefined ? res.newBalance : 0;

    window.appState.setState({
      balance: newBal,
      depositBalance: newDepBal
    });

    if (window.MiningModule && window.MiningModule.updateBalanceUI) {
      window.MiningModule.updateBalanceUI(newBal, newDepBal);
    }

    const amtText = `${parseFloat(creditAmt).toFixed(2)} USDT`;
    window.ModalManager.showToast(`🎉 Deposit of ${amtText} Confirmed & Added!`, 'success');

    // 4. Auto close modal after brief celebration
    setTimeout(() => {
      window.ModalManager.closeModal('modal-deposit');
      this.loadProfileWalletStats();
    }, 2500);
  },

  validateDepositAmount(amt) {
    const amtCard = document.getElementById('deposit-amount-card');
    const errEl = document.getElementById('deposit-amount-error');
    const num = parseFloat(amt);

    if (isNaN(num) || num < 1) {
      if (amtCard) amtCard.classList.add('input-error');
      if (errEl) errEl.style.display = 'flex';
      return false;
    } else {
      if (amtCard) amtCard.classList.remove('input-error');
      if (errEl) errEl.style.display = 'none';
      return true;
    }
  },

  bindDepositEvents() {
    // Preset amount pills
    const pills = document.querySelectorAll('.preset-pill');
    const amtInput = document.getElementById('topup-amount-input');
    const amtCard = document.getElementById('deposit-amount-card');
    const errEl = document.getElementById('deposit-amount-error');

    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const val = pill.dataset.amt;
        if (amtInput) amtInput.value = val;
        this.currentDepositAmount = parseFloat(val) || 1;
        this.validateDepositAmount(this.currentDepositAmount);
      });
    });

    if (amtInput) {
      amtInput.addEventListener('input', () => {
        const val = amtInput.value;
        const num = parseFloat(val);
        this.currentDepositAmount = isNaN(num) ? 0 : num;
        
        // Live validation: turns red and shows error if < 1
        this.validateDepositAmount(this.currentDepositAmount);

        pills.forEach(p => {
          if (p.dataset.amt === val) p.classList.add('active');
          else p.classList.remove('active');
        });
      });
    }

    // Network cards selection
    const netCards = document.querySelectorAll('#deposit-networks-grid .withdraw-net-card');
    netCards.forEach(card => {
      card.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        netCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.currentDepositNetwork = card.dataset.network || 'USDT BEP20';
        this.depositAddress = card.dataset.address || '0x91AbcbAbE89945De4e491bf8850Bae836dB66547';
      });
    });

    // Proceed to Step 2 (Top up button)
    const proceedBtn = document.getElementById('btn-proceed-topup');
    if (proceedBtn) {
      proceedBtn.addEventListener('click', () => {
        const amt = parseFloat(amtInput?.value);
        if (isNaN(amt) || amt < 1) {
          window.TelegramService.hapticNotification('error');
          this.validateDepositAmount(amt);
          
          // Re-trigger shake animation
          if (amtCard) {
            amtCard.classList.remove('input-error');
            void amtCard.offsetWidth; // trigger reflow
            amtCard.classList.add('input-error');
          }

          window.ModalManager.showToast('Minimum deposit amount is 1 USDT ($1)', 'error');
          if (amtInput) amtInput.focus();
          return;
        }

        this.currentDepositAmount = amt;
        this.goToDepositStep2();
      });
    }

    // Back from Step 2 to Step 1
    const backBtn = document.getElementById('btn-back-deposit-step1');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        this.stopDepositPolling();
        const step1 = document.getElementById('deposit-step-1');
        const step2 = document.getElementById('deposit-step-2');
        if (step2) {
          step2.classList.remove('active');
          step2.style.display = 'none';
        }
        if (step1) {
          step1.classList.add('active');
          step1.style.display = 'flex';
        }
      });
    }

    // Copy Deposit Address in Step 2
    const copyAddrBtn = document.getElementById('btn-copy-deposit-addr');
    if (copyAddrBtn) {
      copyAddrBtn.addEventListener('click', () => {
        const addr = document.getElementById('deposit-crypto-address')?.textContent || this.depositAddress;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(addr);
        }
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast('Address copied to clipboard!', 'success');
      });
    }

    // Copy Exact Amount inline link in Step 2
    const copyAmtBtn = document.getElementById('btn-copy-pay-amount');
    if (copyAmtBtn) {
      copyAmtBtn.addEventListener('click', () => {
        const amtStr = this.currentExactAmount ? `${this.currentExactAmount}` : `${this.currentDepositAmount}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(amtStr);
        }
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast(`Exact amount ${amtStr} USDT copied!`, 'success');
      });
    }

    // Verify Deposit Button Click in Step 2 (Active On-Demand BSC Blockchain Scan)
    const verifyBtn = document.getElementById('btn-verify-deposit');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', async () => {
        window.TelegramService.hapticImpact('medium');
        const verifyTextEl = document.getElementById('btn-verify-deposit-text');
        const origHtml = verifyTextEl ? verifyTextEl.innerHTML : `⚡ I have paid • Verify Deposit (${this.currentExactAmount || parseFloat(this.currentDepositAmount).toFixed(4)} USDT)`;
        
        verifyBtn.disabled = true;
        if (verifyTextEl) {
          verifyTextEl.innerHTML = '<span class="btn-spinner-icon"></span><span>Scanning BSC Blockchain...</span>';
        }

        try {
          const res = await window.ApiService.checkDepositStatus();
          if (res && res.confirmed === true) {
            if (verifyTextEl) verifyTextEl.innerHTML = '<span>✅ Verified & Credited!</span>';
            verifyBtn.classList.add('btn-verified-success');
            this.handleDepositConfirmed(res);
            return;
          } else {
            window.TelegramService.hapticNotification('warning');
            const amtStr = this.currentExactAmount ? `${this.currentExactAmount} USDT` : `${this.currentDepositAmount} USDT`;
            window.ModalManager.showToast(`🔍 Scanning BSC... Transfer not found yet. Please make sure exact ${amtStr} was sent to the address.`, 'info');
          }
        } catch (err) {
          console.warn('Manual verify status check error:', err);
          window.ModalManager.showToast('Network error while scanning BSC. Please try again in a few seconds.', 'error');
        } finally {
          setTimeout(() => {
            if (verifyBtn && !verifyBtn.classList.contains('btn-verified-success')) {
              verifyBtn.disabled = false;
              if (verifyTextEl) verifyTextEl.innerHTML = origHtml;
            }
          }, 1800);
        }
      });
    }
  },

  async goToDepositStep2() {
    window.TelegramService.hapticImpact('medium');

    const step1 = document.getElementById('deposit-step-1');
    const step2 = document.getElementById('deposit-step-2');
    const proceedTopupBtn = document.getElementById('btn-proceed-topup');

    const amountNum = parseFloat(this.currentDepositAmount) || 3;

    // Reset live status card and verify button
    const liveCard = document.getElementById('deposit-live-status-card');
    const liveTitle = document.getElementById('deposit-status-title');
    const liveDesc = document.getElementById('deposit-status-desc');
    const liveBadge = document.getElementById('deposit-live-badge');
    const verifyBtn = document.getElementById('btn-verify-deposit');
    const verifyTextEl = document.getElementById('btn-verify-deposit-text');

    if (liveCard) liveCard.classList.remove('confirmed');
    if (liveTitle) liveTitle.textContent = 'Waiting for transfer';
    if (liveDesc) liveDesc.textContent = 'We check incoming payments automatically';
    if (liveBadge) liveBadge.innerHTML = '<span class="live-dot"></span><span>LIVE</span>';

    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.classList.remove('btn-verified-success');
    }
    if (verifyTextEl) {
      verifyTextEl.innerHTML = `<span>⚡ I have paid • Verify Deposit (${this.currentExactAmount || amountNum.toFixed(4)} USDT)</span>`;
    }

    // Show loading state on button while registering deposit intent
    if (proceedTopupBtn) {
      proceedTopupBtn.disabled = true;
      proceedTopupBtn.innerHTML = '<span>Preparing details...</span>';
    }

    try {
      const intentRes = await window.ApiService.createDepositIntent(amountNum, this.currentDepositNetwork);
      if (intentRes && intentRes.success && intentRes.exactAmount) {
        this.currentExactAmount = intentRes.exactAmount;
        if (intentRes.depositAddress) this.depositAddress = intentRes.depositAddress;
      } else {
        // Deterministic fallback if offline
        const user = window.TelegramService?.getUser ? window.TelegramService.getUser() : null;
        const idStr = String(user?.id || '42').replace(/\D/g, '') || '42';
        const last2 = idStr.slice(-2).padStart(2, '42');
        this.currentExactAmount = `${Math.floor(amountNum)}.00${last2}`;
      }
    } catch (e) {
      console.warn('createDepositIntent error:', e);
      const user = window.TelegramService?.getUser ? window.TelegramService.getUser() : null;
      const idStr = String(user?.id || '42').replace(/\D/g, '') || '42';
      const last2 = idStr.slice(-2).padStart(2, '42');
      this.currentExactAmount = `${Math.floor(amountNum)}.00${last2}`;
    } finally {
      if (proceedTopupBtn) {
        proceedTopupBtn.disabled = false;
        proceedTopupBtn.innerHTML = '<span>Top up</span>';
      }
    }

    // Populate data
    const payAmtEl = document.getElementById('pay-detail-amount');
    const payNetNameEl = document.getElementById('pay-detail-network-name');
    const payIconWrapEl = document.getElementById('pay-detail-icon-wrap');
    const addrEl = document.getElementById('deposit-crypto-address');
    const qrImgEl = document.getElementById('deposit-qr-image');

    if (payAmtEl) payAmtEl.textContent = `${this.currentExactAmount} USDT`;
    if (payNetNameEl) payNetNameEl.textContent = this.currentDepositNetwork || 'USDT BEP20';
    if (addrEl) addrEl.textContent = this.depositAddress || '0x91AbcbAbE89945De4e491bf8850Bae836dB66547';

    if (verifyTextEl) {
      verifyTextEl.innerHTML = `<span>⚡ I have paid • Verify Deposit (${this.currentExactAmount || amountNum.toFixed(4)} USDT)</span>`;
    }

    // Update dynamic QR Code
    if (qrImgEl) {
      const targetAddr = this.depositAddress || '0x91AbcbAbE89945De4e491bf8850Bae836dB66547';
      qrImgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(targetAddr)}`;
    }

    // Update Icon
    if (payIconWrapEl) {
      if (this.currentDepositNetwork === 'BNB') {
        payIconWrapEl.innerHTML = `
          <div class="net-main-icon bnb-bg">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="#F3BA2F"/>
              <path d="M12 6L14.5 8.5L12 11L9.5 8.5L12 6Z" fill="#FFFFFF"/>
              <path d="M16 10L18.5 12.5L16 15L13.5 12.5L16 10Z" fill="#FFFFFF"/>
              <path d="M8 10L10.5 12.5L8 15L5.5 12.5L8 10Z" fill="#FFFFFF"/>
              <path d="M12 14L14.5 16.5L12 19L9.5 16.5L12 14Z" fill="#FFFFFF"/>
              <path d="M12 11L13.5 12.5L12 14L10.5 12.5L12 11Z" fill="#FFFFFF"/>
            </svg>
          </div>
          <span class="net-sub-badge badge-bep">B</span>
        `;
      } else {
        payIconWrapEl.innerHTML = `
          <div class="net-main-icon tether-bg">
            <img src="/assets/icons/usdt-logo.avif" alt="USDT" class="net-img-icon" />
          </div>
          <span class="net-sub-badge badge-bep">B</span>
        `;
      }
    }

    if (step1) {
      step1.classList.remove('active');
      step1.style.display = 'none';
    }
    if (step2) {
      step2.classList.add('active');
      step2.style.display = 'flex';
    }

    // Start automated background polling on Step 2
    this.startDepositPolling();
  },

  networkConfigs: {
    'USDT BEP20': { min: 0.15, fee: 0.005 },
    'USDT TRC20': { min: 10.0, fee: 1.0 },
    'USDT TON':   { min: 10.0, fee: 1.0 },
    'USDT SOL':   { min: 10.0, fee: 1.0 }
  },

  bindWithdrawEvents() {
    // 1. Network selection
    const netCards = document.querySelectorAll('.withdraw-net-card');
    netCards.forEach(card => {
      card.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        netCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.currentWithdrawNetwork = card.dataset.network || 'USDT BEP20';
        
        const config = this.networkConfigs[this.currentWithdrawNetwork] || this.networkConfigs['USDT BEP20'];
        const minEl = document.getElementById('withdraw-min-limit-val');
        const feeEl = document.getElementById('withdraw-platform-fee-val');
        const amtInput = document.getElementById('withdraw-amount-input');

        if (minEl) minEl.textContent = `${config.min} USDT`;
        if (feeEl) feeEl.textContent = `${config.fee} USDT`;
        if (amtInput) {
          amtInput.placeholder = config.min.toString();
          amtInput.min = config.min.toString();
        }

        this.updateWithdrawCalculation();
      });
    });

    // 2. Realtime Amount Calculation
    const amtInput = document.getElementById('withdraw-amount-input');
    if (amtInput) {
      amtInput.addEventListener('input', () => this.updateWithdrawCalculation());
    }

    // 3. MAX Button
    const maxBtn = document.getElementById('btn-withdraw-max');
    if (maxBtn) {
      maxBtn.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        const state = window.appState.getState();
        const bal = state.balance || 0;
        if (amtInput) {
          amtInput.value = bal.toFixed(4);
          this.updateWithdrawCalculation();
        }
      });
    }

    // 4. Paste Button for Wallet Address
    const pasteBtn = document.getElementById('btn-paste-withdraw-addr');
    const addrInput = document.getElementById('withdraw-address-input');
    if (pasteBtn && addrInput) {
      pasteBtn.addEventListener('click', async () => {
        window.TelegramService.hapticSelection();
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text) {
              addrInput.value = text.trim();
              this.checkWalletAddressState(addrInput.value);
              window.ModalManager.showToast('Wallet address pasted!', 'success');
              return;
            }
          }
        } catch (e) {
          console.warn('Clipboard read failed:', e);
        }
        addrInput.focus();
      });
    }

    // Realtime input listener for withdrawal address
    if (addrInput) {
      addrInput.addEventListener('input', () => {
        this.checkWalletAddressState(addrInput.value);
      });
    }

    // "Purchase Plan" button in withdrawal address warning bar
    const buyPlanBtn = document.getElementById('btn-withdraw-buy-plan');
    if (buyPlanBtn) {
      buyPlanBtn.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        window.ModalManager.closeModal('modal-withdraw');
        if (window.App && window.App.switchTab) {
          window.App.switchTab('nft');
        }
      });
    }

    // "Reset" button to revert back to saved address
    const resetAddrBtn = document.getElementById('btn-withdraw-reset-addr');
    if (resetAddrBtn && addrInput) {
      resetAddrBtn.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        addrInput.value = this.savedWalletAddress || '';
        this.checkWalletAddressState(addrInput.value);
        window.ModalManager.showToast('Restored saved wallet address', 'info');
      });
    }

    // 5. Submit Withdraw Action
    const submitWithBtn = document.getElementById('btn-submit-withdraw');
    if (submitWithBtn) {
      submitWithBtn.addEventListener('click', () => this.handleWithdraw());
    }
  },

  /**
   * Check and display dynamic status for withdrawal address:
   * - 1st address: informational note that this will be bound
   * - Address change with NO purchased plan: error state + Purchase Plan button
   * - Address change WITH purchased plan: success state
   */
  checkWalletAddressState(currentInputVal) {
    const card = document.getElementById('withdraw-wallet-card');
    const badge = document.getElementById('withdraw-addr-badge');
    const statusBar = document.getElementById('withdraw-addr-status-bar');
    const statusIcon = document.getElementById('withdraw-status-icon');
    const statusText = document.getElementById('withdraw-status-text');
    const statusActions = document.getElementById('withdraw-status-actions');
    const inputVal = (currentInputVal || '').trim();

    // Case 1: User has never saved an address yet
    if (!this.savedWalletAddress) {
      if (badge) badge.style.display = 'none';
      if (card) card.classList.remove('has-error', 'has-success');

      if (inputVal.length >= 5) {
        if (statusBar) {
          statusBar.style.display = 'flex';
          statusBar.className = 'withdraw-addr-status-bar status-info';
        }
        if (statusIcon) statusIcon.textContent = '💡';
        if (statusText) statusText.textContent = 'Initial address: This wallet will be bound to your account for future withdrawals.';
        if (statusActions) statusActions.style.display = 'none';
      } else {
        if (statusBar) statusBar.style.display = 'none';
      }
      return true;
    }

    // Case 2: User has a saved address
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = '🔒 Saved';
    }

    // If matching currently saved address
    if (!inputVal || inputVal.toLowerCase() === this.savedWalletAddress.toLowerCase()) {
      if (card) card.classList.remove('has-error', 'has-success');
      if (statusBar) statusBar.style.display = 'none';
      if (statusActions) statusActions.style.display = 'none';
      return true;
    }

    // Case 3: User entered a NEW/DIFFERENT address
    if (!this.hasFastMiner) {
      // Free user: BLOCK with error
      if (card) {
        card.classList.add('has-error');
        card.classList.remove('has-success');
      }
      if (statusBar) {
        statusBar.style.display = 'flex';
        statusBar.className = 'withdraw-addr-status-bar';
      }
      if (statusIcon) statusIcon.textContent = '⚠️';
      if (statusText) statusText.textContent = 'To change your withdrawal wallet address, you must purchase a mining plan.';
      if (statusActions) statusActions.style.display = 'flex';
      return false;
    } else {
      // Plan purchased user: ALLOW with positive feedback
      if (card) {
        card.classList.remove('has-error');
        card.classList.add('has-success');
      }
      if (statusBar) {
        statusBar.style.display = 'flex';
        statusBar.className = 'withdraw-addr-status-bar status-success';
      }
      if (statusIcon) statusIcon.textContent = '✨';
      if (statusText) statusText.textContent = 'Plan Active: Your address will be updated to this new wallet upon withdrawal.';
      if (statusActions) statusActions.style.display = 'none';
      return true;
    }
  },

  updateWithdrawCalculation() {
    const amtInput = document.getElementById('withdraw-amount-input');
    const receivedEl = document.getElementById('withdraw-received-val');
    const amt = parseFloat(amtInput?.value) || 0;
    const config = this.networkConfigs[this.currentWithdrawNetwork] || this.networkConfigs['USDT BEP20'];
    const fee = config.fee;

    if (receivedEl) {
      if (amt >= config.min) {
        const receiveVal = Math.max(0, amt - fee);
        receivedEl.textContent = `${receiveVal.toFixed(4)} USDT`;
      } else {
        receivedEl.textContent = `0.0000 USDT`;
      }
    }
  },

  turnstileWidgetId: null,
  turnstileToken: '',
  siteKeys: [
    '0x4AAAAAAFHWuDzRc4UGLOJmo9WXQScgzOk',
    '0x4AAAAAAFHWuB54UEvkuKEt',
    '1x00000000000000000000AA'
  ],
  currentSiteKeyIndex: 0,

  renderTurnstile() {
    const container = document.getElementById('cf-turnstile-container');
    if (!container) return;

    if (!window.turnstile) {
      setTimeout(() => this.renderTurnstile(), 250);
      return;
    }

    try {
      if (this.turnstileWidgetId !== null) {
        try { window.turnstile.remove(this.turnstileWidgetId); } catch (e) {}
        this.turnstileWidgetId = null;
      }
      container.innerHTML = '';

      const sitekey = this.siteKeys[this.currentSiteKeyIndex] || '1x00000000000000000000AA';
      this.turnstileWidgetId = window.turnstile.render(container, {
        sitekey: sitekey,
        theme: 'auto',
        size: 'flexible',
        callback: (token) => {
          this.turnstileToken = token;
        },
        'error-callback': (errorCode) => {
          console.warn('Turnstile error on key:', sitekey, 'Error code:', errorCode);
          if (this.currentSiteKeyIndex < this.siteKeys.length - 1) {
            this.currentSiteKeyIndex++;
            setTimeout(() => this.renderTurnstile(), 150);
          }
        },
        'expired-callback': () => {
          this.turnstileToken = '';
        }
      });
    } catch (err) {
      console.warn('Turnstile render exception:', err);
    }
  },

  openWithdrawPage() {
    const state = window.appState.getState();
    const user = state.user || {};
    const availBalEl = document.getElementById('withdraw-avail-bal');
    if (availBalEl) {
      availBalEl.textContent = `${(state.balance || 0).toFixed(4)} USDT`;
    }
    
    // Reset to USDT BEP20 default
    this.currentWithdrawNetwork = 'USDT BEP20';
    const netCards = document.querySelectorAll('.withdraw-net-card');
    netCards.forEach(c => {
      if (c.dataset.network === 'USDT BEP20') c.classList.add('active');
      else c.classList.remove('active');
    });

    const minEl = document.getElementById('withdraw-min-limit-val');
    const feeEl = document.getElementById('withdraw-platform-fee-val');
    const amtInput = document.getElementById('withdraw-amount-input');
    const addrInput = document.getElementById('withdraw-address-input');

    if (minEl) minEl.textContent = '0.15 USDT';
    if (feeEl) feeEl.textContent = '0.005 USDT';
    if (amtInput) {
      amtInput.placeholder = '0.15';
      amtInput.min = '0.15';
    }

    // Load saved wallet address & plan status
    const savedAddr = (user.walletAddress && !user.walletAddress.includes('...')) ? user.walletAddress.trim() : null;
    this.savedWalletAddress = savedAddr;
    this.hasFastMiner = Boolean(user.hasFastMiner ?? state.hasFastMiner);

    if (addrInput) {
      addrInput.value = this.savedWalletAddress || '';
    }
    this.checkWalletAddressState(addrInput?.value);

    this.updateWithdrawCalculation();

    window.ModalManager.openModal('modal-withdraw');

    // Background fetch latest wallet info to guarantee up-to-date plan & saved address
    window.ApiService.getWalletDetails().then(res => {
      if (res && res.success) {
        if (res.walletAddress && !res.walletAddress.includes('...')) {
          this.savedWalletAddress = res.walletAddress.trim();
        }
        if (res.hasFastMiner !== undefined) {
          this.hasFastMiner = Boolean(res.hasFastMiner);
        }
        if (addrInput && !addrInput.value && this.savedWalletAddress) {
          addrInput.value = this.savedWalletAddress;
        }
        this.checkWalletAddressState(addrInput?.value);
      }
    }).catch(() => {});

    // Explicitly render Turnstile once modal becomes visible
    setTimeout(() => {
      this.renderTurnstile();
    }, 100);
  },

  async handleDeposit() {
    const amt = this.currentDepositAmount || parseFloat(document.getElementById('topup-amount-input')?.value) || 3.0;
    const txInput = document.getElementById('deposit-txhash-input');
    const txHash = txInput?.value?.trim() || '';

    if (!txHash) {
      window.TelegramService.hapticNotification('warning');
      window.ModalManager.showToast('Please enter or paste your Transaction ID (TxID)!', 'error');
      if (txInput) txInput.focus();
      return;
    }

    const confirmBtn = document.getElementById('btn-confirm-tx-hash');
    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : '<span>Confirm & Add USDT</span>';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>Verifying TxID...</span>';
    }

    window.TelegramService.hapticImpact('heavy');
    try {
      const res = await window.ApiService.deposit(amt, this.currentDepositNetwork, txHash);
      if (res.success) {
        window.TelegramService.hapticNotification('success');
        if (window.MiningModule && window.MiningModule.playSuccessSound) {
          window.MiningModule.playSuccessSound();
        }
        window.appState.setState({
          balance: res.newBalance,
          depositBalance: res.depositBalance
        });
        if (window.MiningModule && window.MiningModule.updateBalanceUI) {
          window.MiningModule.updateBalanceUI(res.newBalance, res.depositBalance);
        }
        window.ModalManager.closeModal('modal-deposit');
        if (txInput) txInput.value = '';
        this.loadProfileWalletStats();
      } else {
        window.ModalManager.showToast(res.message || 'Verification failed. Please check TxID.', 'error');
      }
    } catch (err) {
      console.error('Deposit error:', err);
      window.ModalManager.showToast('Failed to verify deposit. Please try again.', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  async handleWithdraw() {
    const amtInput = document.getElementById('withdraw-amount-input');
    const addrInput = document.getElementById('withdraw-address-input');
    const amt = parseFloat(amtInput?.value);
    const addr = addrInput?.value.trim();
    const state = window.appState.getState();
    const config = this.networkConfigs[this.currentWithdrawNetwork] || this.networkConfigs['USDT BEP20'];

    if (!amt || amt < config.min) {
      window.ModalManager.showToast(`Minimum withdrawal for ${this.currentWithdrawNetwork} is ${config.min} USDT`, 'error');
      return;
    }

    if (state.balance < amt) {
      window.ModalManager.showToast(`Insufficient balance! Available: ${state.balance.toFixed(4)} USDT`, 'error');
      return;
    }

    if (!addr || addr.length < 5) {
      window.ModalManager.showToast('Please enter a valid crypto withdrawal address', 'error');
      if (addrInput) addrInput.focus();
      return;
    }

    // Check if user is attempting to change an already saved address without a purchased plan
    if (this.savedWalletAddress && addr.toLowerCase() !== this.savedWalletAddress.toLowerCase() && !this.hasFastMiner) {
      window.TelegramService.hapticNotification('error');
      const card = document.getElementById('withdraw-wallet-card');
      if (card) {
        card.classList.remove('has-error');
        void card.offsetWidth;
        card.classList.add('has-error');
      }
      this.checkWalletAddressState(addr);
      window.ModalManager.showToast('⚠️ To change your withdrawal wallet address, you must purchase a mining plan.', 'error');
      return;
    }

    // Cloudflare Turnstile Verification check
    let turnstileToken = this.turnstileToken;
    if (window.turnstile && this.turnstileWidgetId !== null) {
      try {
        turnstileToken = window.turnstile.getResponse(this.turnstileWidgetId) || this.turnstileToken;
      } catch (e) {}
    }

    const turnstileWidget = document.getElementById('cf-turnstile-container');
    if (turnstileWidget && window.turnstile && !turnstileToken) {
      window.ModalManager.showToast('Please complete Cloudflare Captcha verification!', 'error');
      return;
    }

    const submitBtn = document.getElementById('btn-submit-withdraw');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '<span>Withdraw</span>';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Submitting Request...</span>';
    }

    window.TelegramService.hapticImpact('heavy');
    try {
      const res = await window.ApiService.withdraw(amt, addr, this.currentWithdrawNetwork, turnstileToken);
      if (res && res.success) {
        window.TelegramService.hapticNotification('success');
        if (window.MiningModule && window.MiningModule.playSuccessSound) {
          window.MiningModule.playSuccessSound();
        }
        window.ModalManager.showToast(res.message || 'Withdrawal request submitted successfully!', 'success');
        
        // Save new/confirmed wallet address & fast miner state locally
        this.savedWalletAddress = res.walletAddress || addr;
        if (res.hasFastMiner !== undefined) this.hasFastMiner = res.hasFastMiner;

        const curUser = window.appState.getState().user || {};
        window.appState.setState({
          balance: res.newBalance,
          user: {
            ...curUser,
            walletAddress: this.savedWalletAddress,
            hasFastMiner: this.hasFastMiner
          }
        });

        if (window.MiningModule && window.MiningModule.updateBalanceUI) {
          window.MiningModule.updateBalanceUI(res.newBalance);
        }
        window.ModalManager.closeModal('modal-withdraw');
        if (amtInput) amtInput.value = '';
        this.turnstileToken = '';
        this.updateWithdrawCalculation();
        this.loadProfileWalletStats();
      } else {
        const errMsg = res?.message || res?.error || 'Withdrawal failed. Please check details and try again.';
        if (res?.requiresPlan) {
          window.TelegramService.hapticNotification('error');
          const card = document.getElementById('withdraw-wallet-card');
          if (card) {
            card.classList.remove('has-error');
            void card.offsetWidth;
            card.classList.add('has-error');
          }
          this.checkWalletAddressState(addr);
          window.ModalManager.showToast(`⚠️ ${errMsg}`, 'error');
        } else if (res?.dailyLimitReached) {
          window.TelegramService.hapticImpact('medium');
          window.ModalManager.showToast(errMsg, 'warning');
        } else {
          window.TelegramService.hapticNotification('error');
          window.ModalManager.showToast(errMsg, 'error');
        }
      }
    } catch (err) {
      console.error('Withdraw error:', err);
      window.ModalManager.showToast('Network error while processing withdrawal. Please try again.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  async loadProfileWalletStats() {
    const res = await window.ApiService.getWalletDetails();
    if (res.success) {
      const elEarned = document.getElementById('profile-total-earned');
      const elWithdrawn = document.getElementById('profile-total-withdrawn');
      const elTxList = document.getElementById('profile-tx-list');

      if (elEarned) elEarned.textContent = Number(res.totalEarned).toFixed(4);
      if (elWithdrawn) elWithdrawn.textContent = Number(res.totalWithdrawn).toFixed(4);

      if (elTxList && res.transactions) {
        if (res.transactions.length === 0) {
          elTxList.innerHTML = '<div class="tx-empty-state">No transactions yet</div>';
        } else {
          elTxList.innerHTML = res.transactions.map(tx => {
            const hasTxHash = tx.txHash && tx.txHash !== 'N/A' && tx.txHash.length > 10;
            const bscScanUrl = hasTxHash
              ? `https://bscscan.com/tx/${tx.txHash}`
              : `https://bscscan.com/address/0x91AbcbAbE89945De4e491bf8850Bae836dB66547`;
            
            return `
              <div class="tx-item">
                <div class="tx-left-col">
                  <div class="tx-title-row">
                    <span class="tx-name">${tx.type}</span>
                    <a href="${bscScanUrl}" target="_blank" rel="noopener" class="tx-bscscan-link" onclick="if(window.Telegram?.WebApp?.openLink){window.Telegram.WebApp.openLink('${bscScanUrl}');}else{window.open('${bscScanUrl}', '_blank');}event.stopPropagation();">
                      <span>BSC Scan</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                    </a>
                  </div>
                  <span class="tx-time">${tx.date || 'Just now'} • ${tx.status || 'Completed'}</span>
                </div>
                <div class="tx-right-col">
                  <span class="tx-amt ${tx.positive ? 'positive' : 'negative'}">${tx.amount}</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }
  }
};

window.WalletModule = WalletModule;
