const dbService = require('../services/dbService');

exports.getProfile = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    return res.status(200).json({
      success: true,
      data: user
    });
  } catch (err) {
    console.error('userController.getProfile error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { username, walletAddress } = req.body;
    const updates = {};
    if (username) updates.username = username;
    if (walletAddress) updates.walletAddress = walletAddress;

    const updatedUser = await dbService.updateUser(req.userId, updates);

    return res.status(200).json({
      success: true,
      message: "Profile settings updated in Neon database",
      data: updatedUser
    });
  } catch (err) {
    console.error('userController.updateSettings error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
