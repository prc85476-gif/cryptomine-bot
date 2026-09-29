/**
 * Reactive Client State Store
 */
class StateStore {
  constructor() {
    this.state = {
      user: null,
      activeMiner: null,
      balance: 25.4867,
      miningRate: 0.0500,
      streak: null,
      tasks: [],
      nfts: [],
      vipPlans: [],
      currentTab: 'home',
      soundEnabled: true
    };
    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach(listener => listener(this.state));
  }

  getState() {
    return this.state;
  }
}

window.appState = new StateStore();
