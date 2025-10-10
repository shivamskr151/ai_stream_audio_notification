const express = require('express');
const webhookCtrl = require('../controllers/webhook.controller');

const router = express.Router();

router.post('/', webhookCtrl.handleWebhook);

module.exports = router;
