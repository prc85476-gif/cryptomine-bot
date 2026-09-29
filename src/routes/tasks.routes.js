const express = require('express');
const router = express.Router();
const tasksController = require('../controllers/tasksController');

router.get('/list', tasksController.getTasks);
router.post('/claim-streak', tasksController.claimStreak);
router.post('/claim-task', tasksController.claimTask);

module.exports = router;
