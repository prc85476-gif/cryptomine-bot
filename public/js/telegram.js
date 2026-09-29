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
  }
};

window.TelegramService = TelegramService;
