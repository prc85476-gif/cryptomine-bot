/**
 * Telegram WebApp Integration & Haptic Feedback Manager
 */
const TelegramService = {
  tg: window.Telegram ? window.Telegram.WebApp : null,

  init() {
    if (this.tg) {
      try {
        this.tg.ready();
        this.tg.expand();
        // Set header color matching dark theme
        if (this.tg.setHeaderColor) {
          this.tg.setHeaderColor('#080d1e');
        }
        if (this.tg.setBackgroundColor) {
          this.tg.setBackgroundColor('#060914');
        }
        console.log('⚡ Telegram WebApp SDK ready:', this.tg.initDataUnsafe);
      } catch (e) {
        console.warn('Telegram WebApp init warning:', e);
      }
    }
  },

  hapticImpact(style = 'medium') {
    if (this.tg?.HapticFeedback) {
      try {
        this.tg.HapticFeedback.impactOccurred(style);
      } catch (e) {}
    }
  },

  hapticNotification(type = 'success') {
    if (this.tg?.HapticFeedback) {
      try {
        this.tg.HapticFeedback.notificationOccurred(type);
      } catch (e) {}
    }
  },

  hapticSelection() {
    if (this.tg?.HapticFeedback) {
      try {
        this.tg.HapticFeedback.selectionChanged();
      } catch (e) {}
    }
  },

  getUser() {
    return this.tg?.initDataUnsafe?.user || null;
  },

  getStartParam() {
    let param = this.tg?.initDataUnsafe?.start_param || null;
    if (!param && window.location.search) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        param = urlParams.get('tgWebAppStartParam') || urlParams.get('start_param') || urlParams.get('startapp') || urlParams.get('start') || urlParams.get('ref');
      } catch (e) {}
    }
    if (!param && window.location.hash) {
      try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        param = hashParams.get('tgWebAppStartParam') || hashParams.get('start_param') || hashParams.get('startapp');
      } catch (e) {}
    }
    if (param) {
      try {
        localStorage.setItem('cryptomine_referrer_param', String(param).trim());
      } catch (e) {}
      return String(param).trim();
    }
    try {
      return localStorage.getItem('cryptomine_referrer_param') || null;
    } catch (e) {
      return null;
    }
  }
};

window.TelegramService = TelegramService;
