const express = require('express');
const eventCtrl = require('../controllers/event.controller');

const router = express.Router();

router.get('/', eventCtrl.list);
router.get('/page', eventCtrl.list);
router.get('/:id', eventCtrl.get);
router.post('/', eventCtrl.create);
router.post('/upsert', eventCtrl.upsert);
router.put('/:id', eventCtrl.update);
router.delete('/:id', eventCtrl.remove);
router.delete('/', eventCtrl.removeAll);

module.exports = router;
