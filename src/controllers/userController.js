const dbService = require('../services/dbService');

exports.getProfile = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    const hasFastMiner = await dbService.hasFastMiner(req.userId);
    return res.status(200).json({
      success: true,
      data: {
        ...user,
        hasFastMiner
      }
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

    if (walletAddress !== undefined && walletAddress !== null) {
      const trimmedAddr = walletAddress.trim();
      const user = await dbService.getUser(req.userId, req.userMeta);
      const currentSavedAddr = (user.walletAddress && !user.walletAddress.includes('...')) ? user.walletAddress.trim() : null;

      if (currentSavedAddr && trimmedAddr && currentSavedAddr.toLowerCase() !== trimmedAddr.toLowerCase()) {
        const isFastMiner = await dbService.hasFastMiner(req.userId);
        if (!isFastMiner) {
          return res.status(400).json({
            success: false,
            requiresPlan: true,
            message: "To change your withdrawal wallet address, you must purchase a mining plan."
          });
        }
      }
      updates.walletAddress = trimmedAddr;
    }

    const updatedUser = await dbService.updateUser(req.userId, updates);
    const isFastMiner = await dbService.hasFastMiner(req.userId);

    return res.status(200).json({
      success: true,
      message: "Profile settings updated in Neon database",
      data: {
        ...updatedUser,
        hasFastMiner: isFastMiner
      }
    });
  } catch (err) {
    console.error('userController.updateSettings error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.claimGiftBox = async (req, res) => {
  try {
    const { giftType, boostPercent } = req.body || {};
    const result = await dbService.claimGiftBox(req.userId, { giftType, boostPercent });
    return res.status(200).json(result);
  } catch (err) {
    console.error('userController.claimGiftBox error:', err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to claim gift box reward."
    });
  }
};

exports.getGiftBoxInfo = async (req, res) => {
  try {
    const user = await dbService.getUser(req.userId, req.userMeta);
    return res.status(200).json({
      success: true,
      availableBoxes: user.giftBoxesAvailable,
      openedBoxes: user.giftBoxesOpened,
      referralCode: user.referralCode
    });
  } catch (err) {
    console.error('userController.getGiftBoxInfo error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

