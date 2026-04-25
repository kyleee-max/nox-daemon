// src/routes/system.js
'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/systemController');

router.get('/system',        ctrl.ping);
router.get('/system/docker', ctrl.dockerInfo);

module.exports = router;
