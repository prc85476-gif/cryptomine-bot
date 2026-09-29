/**
 * Live Withdrawal Social Proof Notification Popup
 * Shows periodic realistic withdrawal activity ($1.00 - $5.00) with glassmorphism blur & swipe/drag dismiss
 */
const LiveWithdrawalPopup = {
  container: null,
  timer: null,
  hideTimer: null,
  isInitialized: false,
  isDragging: false,
  startX: 0,
  currentX: 0,
  diffX: 0,

  users: [
    '@In***11', '@Da***84', '@Al***29', '@Sa***77', '@Kr***03',
    '@Ro***92', '@Mi***18', '@El***55', '@Jo***30', '@Be***48',
    '@Lu***61', '@Vi***09', '@Ni***85', '@Za***23', '@Ke***67',
    '@Ar***14', '@Fe***80', '@To***36', '@Ch***95', '@Le***52',
    '@Ma***19', '@St***73', '@Em***41', '@No***68', '@Li***99'
  ],
  // Realistic withdrawal amounts strictly between $1.00 to $5.00
  amounts: [
    1.15, 1.25, 1.40, 1.50, 1.65, 1.80, 1.95, 2.10,
    2.25, 2.45, 2.60, 2.80, 3.10, 3.35, 3.50, 3.85,
    4.10, 4.25, 4.50, 4.75, 4.90, 5.00
  ],

  CHANNEL_URL: 'https://t.me/cryptomintwithdraw',

  openChannel() {
    if (window.TelegramService?.hapticImpact) {
      window.TelegramService.hapticImpact('medium');
    }
    const url = this.CHANNEL_URL;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  },

  init() {
    if (this.isInitialized) return;
    this.container = document.getElementById('live-withdrawal-popup');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'live-withdrawal-popup';
      this.container.className = 'live-withdraw-toast';
      const tma = document.querySelector('.tma-container') || document.body;
      tma.appendChild(this.container);
    }

    this.bindGestures();
    this.isInitialized = true;

    // Start initial popup cycle quickly (after 800ms)
    setTimeout(() => {
      this.triggerNext();
    }, 800);
  },

  bindGestures() {
    if (!this.container) return;

    // 1. Touch Events (Mobile / Telegram Mini App)
    this.container.addEventListener('touchstart', (e) => {
      if (!this.container.classList.contains('show')) return;
      this.isDragging = true;
      this.startX = e.touches[0].clientX;
      this.currentX = this.startX;
      this.diffX = 0;
      this.container.style.transition = 'none';
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      if (!this.isDragging) return;
      this.currentX = e.touches[0].clientX;
      this.diffX = this.currentX - this.startX;
      // Real-time drag translation
      this.container.style.transform = `translateX(${this.diffX}px) scale(${1 - Math.min(Math.abs(this.diffX) / 400, 0.15)})`;
      this.container.style.opacity = `${1 - Math.min(Math.abs(this.diffX) / 200, 0.6)}`;
    }, { passive: true });

    this.container.addEventListener('touchend', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.handleRelease();
    });

    // 2. Mouse Events (Desktop Browsers)
    this.container.addEventListener('mousedown', (e) => {
      if (!this.container.classList.contains('show')) return;
      this.isDragging = true;
      this.startX = e.clientX;
      this.currentX = this.startX;
      this.diffX = 0;
      this.container.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || !this.container) return;
      this.currentX = e.clientX;
      this.diffX = this.currentX - this.startX;
      this.container.style.transform = `translateX(${this.diffX}px) scale(${1 - Math.min(Math.abs(this.diffX) / 400, 0.15)})`;
      this.container.style.opacity = `${1 - Math.min(Math.abs(this.diffX) / 200, 0.6)}`;
    });

    window.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.handleRelease();
    });

    // 3. Click / Tap to open channel link (or swipe to dismiss)
    this.container.addEventListener('click', (e) => {
      if (Math.abs(this.diffX) < 10) {
        this.openChannel();
        this.dismissImmediately('left');
      }
    });
  },

  handleRelease() {
    if (!this.container) return;

    // Reset inline styles
    this.container.style.transition = '';

    // If dragged/flung/pushed more than 30px ("dhakka dile")
    if (Math.abs(this.diffX) > 30) {
      const direction = this.diffX < 0 ? 'left' : 'right';
      this.dismissImmediately(direction);
    } else {
      // Spring back to center
      this.container.style.transform = 'translateY(0) scale(1)';
      this.container.style.opacity = '1';
    }
  },

  dismissImmediately(direction = 'left') {
    if (!this.container) return;

    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (window.TelegramService?.hapticSelection) {
      window.TelegramService.hapticSelection();
    }

    this.container.style.transform = '';
    this.container.style.opacity = '';
    this.container.classList.remove('show');
    this.container.classList.add(direction === 'left' ? 'dismiss-left' : 'dismiss-right');

    setTimeout(() => {
      if (this.container) {
        this.container.classList.remove('dismiss-left', 'dismiss-right');
      }
    }, 300);

    // Schedule next popup after 4-6 seconds
    const nextDelay = Math.floor(Math.random() * 2500) + 4000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.triggerNext();
    }, nextDelay);
  },

  triggerNext() {
    if (!this.container) return;

    // Show withdrawal toast
    this.showRandomWithdrawal();

    // Schedule next popup after 4.5 to 7.5 seconds
    const nextDelay = Math.floor(Math.random() * 3000) + 4500;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.triggerNext();
    }, nextDelay);
  },

  showRandomWithdrawal() {
    if (!this.container) return;

    const user = this.users[Math.floor(Math.random() * this.users.length)];
    const amt = this.amounts[Math.floor(Math.random() * this.amounts.length)].toFixed(2);

    this.container.style.transform = '';
    this.container.style.opacity = '';
    this.container.classList.remove('dismiss-left', 'dismiss-right');

    this.container.innerHTML = `
      <div class="withdraw-toast-card">
        <div class="withdraw-toast-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </div>
        <div class="withdraw-toast-content">
          <div class="withdraw-toast-top-row">
            <span class="withdraw-toast-user">${user}</span>
            <span class="withdraw-toast-badge"><span class="withdraw-dot-pulse"></span> Paid</span>
          </div>
          <div class="withdraw-toast-details">
            <span class="withdraw-toast-action">Withdrawal</span>
            <span class="withdraw-toast-amt">+$${amt} USDT</span>
          </div>
          <div class="withdraw-toast-time">BEP-20 • Just now</div>
        </div>
      </div>
    `;

    // Trigger smooth slide in
    this.container.classList.add('show');

    // Auto-hide after 3.8 seconds
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.container && this.container.classList.contains('show')) {
        this.container.classList.remove('show');
      }
    }, 3800);
  }
};

window.LiveWithdrawalPopup = LiveWithdrawalPopup;

// Self-initialize on DOM load if not already called
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.LiveWithdrawalPopup.init();
  });
} else {
  window.LiveWithdrawalPopup.init();
}
