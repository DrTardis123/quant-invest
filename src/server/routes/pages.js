'use strict';

const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', '..', 'public', 'index.html'));
});

router.get('/stock/:code', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', '..', 'public', 'index.html'));
});

module.exports = router;
