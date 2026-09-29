const dbService = require('../services/dbService');
const mockDatabase = require('../data/mockDatabase');

const STREAK_DAYS_CONFIG = [
  { day: 1, reward: 0.10, label: "0.10 USDT" },
  { day: 2, reward: 0.20, label: "0.20 USDT" },
  { day: 3, reward: 0.50, label: "0.50 USDT" },
  { day: 4, reward: 0.75, label: "0.75 USDT" },
  { day: 5, reward: 1.00, label: "1.00 USDT" },
  { day: 6, reward: 1.50, label: "1.50 USDT" },
  { day: 7, reward: 3.00, label: "3.00 USDT + NFT Box", special: true }
];

exports.getTasks = async (req, res) => {
  try {
    const streakData = await dbService.getStreakAndTasks(req.userId);
    const completedSet = new Set(streakData.completedTaskIds || []);

    const days = STREAK_DAYS_CONFIG.map(d => ({
      ...d,
      claimed: d.day < streakData.currentDay || (d.day === streakData.currentDay && streakData.claimedToday),
      current: d.day === streakData.currentDay
    }));

    const tasks = mockDatabase.tasks.map(t => ({
      ...t,
      status: completedSet.has(t.id) ? "claimed" : t.status
    }));

    return res.status(200).json({
      success: true,
      streak: {
        currentDay: streakData.currentDay,
        claimedToday: streakData.claimedToday,
        days
      },
      tasks
    });
  } catch (err) {
    console.error('tasksController.getTasks error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.claimStreak = async (req, res) => {
  try {
    const streakData = await dbService.getStreakAndTasks(req.userId);

    if (streakData.claimedToday) {
      return res.status(400).json({
        success: false,
        message: "You have already claimed today's streak reward! Come back tomorrow."
      });
    }

    const currentDayObj = STREAK_DAYS_CONFIG.find(d => d.day === streakData.currentDay) || STREAK_DAYS_CONFIG[0];
    const reward = currentDayObj ? currentDayObj.reward : 0.50;

    const user = await dbService.getUser(req.userId, req.userMeta);
    const newBalance = parseFloat((user.balance + reward).toFixed(4));
    const newEarned = parseFloat((user.totalEarned + reward).toFixed(4));

    // Credit user withdrawable balance & earned in Neon DB
    await dbService.updateUser(req.userId, {
      balance: newBalance,
      totalEarned: newEarned
    });

    // Update streak record in Neon DB
    const updatedStreak = await dbService.updateStreakAndTasks(req.userId, {
      claimedToday: true,
      lastClaimDate: new Date().toISOString().split('T')[0]
    });

    // Log transaction in Neon DB
    await dbService.addTransaction({
      id: `tx-${Date.now()}`,
      userId: req.userId,
      type: `Day ${streakData.currentDay} Streak Claim`,
      amount: `+${reward.toFixed(2)} USDT`,
      status: "Success",
      positive: true,
      date: "Just now"
    });

    const days = STREAK_DAYS_CONFIG.map(d => ({
      ...d,
      claimed: d.day <= streakData.currentDay,
      current: d.day === streakData.currentDay
    }));

    return res.status(200).json({
      success: true,
      message: `Streak reward claimed! +${reward.toFixed(2)} USDT added to your wallet.`,
      reward,
      newBalance,
      streak: {
        currentDay: updatedStreak.currentDay,
        claimedToday: true,
        days
      }
    });
  } catch (err) {
    console.error('tasksController.claimStreak error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.claimTask = async (req, res) => {
  try {
    const { taskId } = req.body;
    const task = mockDatabase.tasks.find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const streakData = await dbService.getStreakAndTasks(req.userId);
    const completedSet = new Set(streakData.completedTaskIds || []);

    if (completedSet.has(taskId)) {
      return res.status(400).json({ success: false, message: "Task reward already claimed!" });
    }

    completedSet.add(taskId);
    const updatedTaskIds = Array.from(completedSet);

    const user = await dbService.getUser(req.userId, req.userMeta);
    const newBalance = parseFloat((user.balance + task.reward).toFixed(4));
    const newEarned = parseFloat((user.totalEarned + task.reward).toFixed(4));

    // Update user balance & earned in Neon DB
    await dbService.updateUser(req.userId, {
      balance: newBalance,
      totalEarned: newEarned
    });

    // Update completed tasks array in Neon DB
    await dbService.updateStreakAndTasks(req.userId, {
      completedTaskIds: updatedTaskIds
    });

    // Log transaction in Neon DB
    await dbService.addTransaction({
      id: `tx-${Date.now()}`,
      userId: req.userId,
      type: `Task: ${task.title}`,
      amount: `+${task.reward.toFixed(2)} USDT`,
      status: "Success",
      positive: true,
      date: "Just now"
    });

    return res.status(200).json({
      success: true,
      message: `Task completed! +${task.reward.toFixed(2)} USDT earned!`,
      reward: task.reward,
      newBalance,
      task: { ...task, status: "claimed" }
    });
  } catch (err) {
    console.error('tasksController.claimTask error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
