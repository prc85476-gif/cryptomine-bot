/**
 * Referral & Affiliate Program Module
 */
const ReferralModule = {
  data: null,

  init() {
    this.bindEvents();
    this.loadReferralData();
  },

  bindEvents() {
    // Copy Referral Link on Page
    const copyBtn = document.getElementById('btn-copy-ref-page');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        this.copyLink();
      });
    }

    // Share Referral Link on Telegram
    const shareBtn = document.getElementById('btn-share-ref-tg-page');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        this.shareOnTelegram();
      });
    }

    // Copy Referral Code
    const copyCodeBtn = document.getElementById('btn-copy-ref-code');
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', () => {
        this.copyCode();
      });
    }
  },

  async loadReferralData() {
    try {
      const res = await window.ApiService.getReferralInfo();
      if (res && res.success) {
        this.data = res;
        this.render();
      }
    } catch (err) {
      console.error('Error loading referral info:', err);
    }
  },

  render() {
    if (!this.data) return;

    const { referralCode, referralLink, invitedCount, totalEarnings, referralList } = this.data;

    // 1. Update Referral Link and Code Inputs/Badges
    const linkInputs = [
      document.getElementById('referral-link-input-page'),
      document.getElementById('referral-link-input')
    ];
    linkInputs.forEach(input => {
      if (input) input.value = referralLink || `https://t.me/cryptomintnftbot?start=${referralCode || 'CRYPTO-9482'}`;
    });

    const codeBadges = document.querySelectorAll('.referral-code-text');
    codeBadges.forEach(badge => {
      badge.textContent = referralCode || 'CRYPTO-9482';
    });

    // 2. Update Stats
    const totalCountEl = document.getElementById('referral-total-count');
    if (totalCountEl) {
      const count = (referralList && referralList.length) ? referralList.length : (invitedCount || 0);
      totalCountEl.textContent = count;
    }

    const totalIncomeEl = document.getElementById('referral-total-income');
    if (totalIncomeEl) {
      totalIncomeEl.textContent = `${Number(totalEarnings || 0).toFixed(2)} USDT`;
    }

    const badgeUsersCount = document.getElementById('referral-users-count-badge');
    if (badgeUsersCount) {
      const count = (referralList && referralList.length) ? referralList.length : (invitedCount || 0);
      badgeUsersCount.textContent = `${count} ${count === 1 ? 'User' : 'Users'}`;
    }

    // 3. Render Referred Users List
    this.renderUsersList(referralList || []);
  },

  renderUsersList(users) {
    const container = document.getElementById('referral-users-container');
    if (!container) return;

    if (!users || users.length === 0) {
      container.innerHTML = `
        <div class="referral-empty-card">
          <div class="referral-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <h4 class="referral-empty-title">No Referrals Yet</h4>
          <p class="referral-empty-desc">Share your referral link with your friends or Telegram groups to start earning instant daily USDT commissions!</p>
          <button class="btn-ref-invite-now" onclick="ReferralModule.shareOnTelegram()">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            Invite Friends Now
          </button>
        </div>
      `;
      return;
    }

    let html = '';
    users.forEach((user, idx) => {
      // Generate initials or avatar symbol
      const cleanName = (user.name || `Miner #${idx + 1}`).replace(/^@/, '');
      const initials = cleanName.substring(0, 2).toUpperCase();
      const earnedText = user.earned ? (user.earned.startsWith('+') ? user.earned : `+${user.earned}`) : '+0.00 USDT';
      const levelText = user.level || 'Tier 1 (10%)';
      const dateText = user.date || 'Active';

      // Tier badge color theme
      let tierClass = 'tier-1';
      if (levelText.includes('Tier 2') || levelText.includes('5%')) tierClass = 'tier-2';
      if (levelText.includes('Tier 3') || levelText.includes('2%')) tierClass = 'tier-3';

      html += `
        <div class="referral-user-item-card">
          <div class="ref-user-left">
            <div class="ref-user-avatar-badge ${tierClass}">
              <span>${initials}</span>
            </div>
            <div class="ref-user-details">
              <div class="ref-user-title-row">
                <span class="ref-user-name">@${cleanName}</span>
                <span class="ref-user-tier-pill ${tierClass}">${levelText}</span>
              </div>
              <div class="ref-user-meta-row">
                <span class="ref-user-date">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  ${dateText}
                </span>
                <span class="ref-user-status-dot">
                  <span class="dot-pulse"></span>
                  Active Miner
                </span>
              </div>
            </div>
          </div>
          <div class="ref-user-right">
            <span class="ref-earned-val">${earnedText}</span>
            <span class="ref-earned-label">Commission</span>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  copyLink() {
    const input = document.getElementById('referral-link-input-page') || document.getElementById('referral-link-input');
    const link = input ? input.value : (this.data?.referralLink || '');

    if (!link) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => {
        this.showCopiedEffect('btn-copy-ref-page');
      }).catch(() => {
        this.fallbackCopy(link);
      });
    } else {
      this.fallbackCopy(link);
    }
  },

  copyCode() {
    const code = this.data?.referralCode || 'CRYPTO-9482';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        window.TelegramService.hapticNotification('success');
        window.ModalManager.showToast(`Referral code ${code} copied!`, 'success');
      });
    }
  },

  showCopiedEffect(btnId) {
    window.TelegramService.hapticNotification('success');
    window.ModalManager.showToast('Referral link copied to clipboard!', 'success');

    const btn = document.getElementById(btnId);
    if (btn) {
      const origText = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Copied!</span>
      `;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = origText;
      }, 2000);
    }
  },

  fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      this.showCopiedEffect('btn-copy-ref-page');
    } catch (e) {
      window.ModalManager.showToast('Could not copy link automatically', 'error');
    }
    document.body.removeChild(textArea);
  },

  shareOnTelegram() {
    window.TelegramService.hapticSelection();
    const link = this.data?.referralLink || document.getElementById('referral-link-input-page')?.value || 'https://t.me/cryptomintnftbot';
    const message = `⛏️ Join CryptoMine with me and earn daily USDT crypto rewards with NFT Miners!\n🎁 Use my referral link to get bonus mining power:\n${link}`;
    const tgShareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(tgShareUrl);
    } else {
      window.open(tgShareUrl, '_blank');
    }
  }
};

window.ReferralModule = ReferralModule;
