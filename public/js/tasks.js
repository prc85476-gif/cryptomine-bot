/**
 * Tasks & Daily Streak Module
 */
const TasksModule = {
  init() {
    this.loadTasks();
  },

  async loadTasks() {
    const res = await window.ApiService.getTasks();
    if (res.success) {
      window.appState.setState({
        streak: res.streak,
        tasks: res.tasks
      });
      this.renderStreak(res.streak);
      this.renderTaskList(res.tasks);
    }
  },

  renderStreak(streak) {
    const grid = document.getElementById('streak-days-grid');
    const claimBtn = document.getElementById('btn-claim-streak-action');
    if (!grid) return;

    grid.innerHTML = streak.days.map(d => {
      let cls = 'streak-day-item';
      if (d.claimed) cls += ' claimed';
      if (d.day === streak.currentDay) cls += ' current';
      return `
        <div class="${cls}">
          <span class="streak-day-lbl">Day ${d.day}</span>
          <span class="streak-day-reward">${d.claimed ? '✓ Done' : d.label}</span>
        </div>
      `;
    }).join('');

    if (claimBtn) {
      if (streak.claimedToday) {
        claimBtn.classList.add('disabled');
        claimBtn.textContent = 'Claimed Today (Come back tomorrow)';
        claimBtn.disabled = true;
      } else {
        claimBtn.classList.remove('disabled');
        claimBtn.textContent = `Claim Day ${streak.currentDay} Reward`;
        claimBtn.disabled = false;
        claimBtn.onclick = () => this.handleClaimStreak();
      }
    }
  },

  async handleClaimStreak() {
    window.TelegramService.hapticImpact('heavy');
    const res = await window.ApiService.claimStreak();
    if (res.success) {
      window.TelegramService.hapticNotification('success');
      window.MiningModule.playSuccessSound();
      window.ModalManager.showToast(res.message, 'success');

      window.appState.setState({
        balance: res.newBalance,
        streak: res.streak
      });

      window.MiningModule.updateBalanceUI(res.newBalance);
      this.renderStreak(res.streak);
    } else {
      window.ModalManager.showToast(res.message, 'error');
    }
  },

  renderTaskList(tasks) {
    const container = document.getElementById('tasks-items-list');
    if (!container) return;

    container.innerHTML = tasks.map(t => {
      let btnLabel = 'Start';
      let btnCls = 'btn-task-action';
      if (t.status === 'completed') {
        btnLabel = 'Claim';
        btnCls += ' completed';
      } else if (t.status === 'claimed') {
        btnLabel = 'Claimed';
        btnCls += ' claimed';
      }

      return `
        <div class="task-card">
          <div class="task-left">
            <div class="task-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            </div>
            <div class="task-info">
              <span class="task-title">${t.title}</span>
              <span class="task-reward-pill"><img src="/assets/icons/usdt-logo.avif" alt="USDT" class="task-usdt-inline-icon" /> +${t.reward} USDT</span>
            </div>
          </div>
          <button class="${btnCls}" onclick="TasksModule.handleTaskAction('${t.id}', '${t.status}', '${t.link || ''}')">
            ${btnLabel}
          </button>
        </div>
      `;
    }).join('');
  },

  async handleTaskAction(taskId, status, link) {
    window.TelegramService.hapticSelection();
    if (status === 'claimed') return;

    if (status === 'pending') {
      if (link) {
        if (window.Telegram?.WebApp?.openTelegramLink && link.includes('t.me')) {
          window.Telegram.WebApp.openTelegramLink(link);
        } else {
          window.open(link, '_blank');
        }
      }
      window.ModalManager.showToast('Verifying task completion...', 'success');
      setTimeout(async () => {
        const res = await window.ApiService.claimTask(taskId);
        if (res.success) {
          window.TelegramService.hapticNotification('success');
          window.MiningModule.playSuccessSound();
          window.ModalManager.showToast(res.message, 'success');
          window.appState.setState({ balance: res.newBalance });
          window.MiningModule.updateBalanceUI(res.newBalance);
          this.loadTasks();
        }
      }, 1500);
      return;
    }

    if (status === 'completed') {
      const res = await window.ApiService.claimTask(taskId);
      if (res.success) {
        window.TelegramService.hapticNotification('success');
        window.MiningModule.playSuccessSound();
        window.ModalManager.showToast(res.message, 'success');
        window.appState.setState({ balance: res.newBalance });
        window.MiningModule.updateBalanceUI(res.newBalance);
        this.loadTasks();
      }
    }
  }
};

window.TasksModule = TasksModule;
