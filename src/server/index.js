'use strict';

const express = require('express');
const path = require('path');
const cfg = require('../config');
const apiRouter = require('./routes/api');
const pagesRouter = require('./routes/pages');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api', apiRouter);
  app.use('/', pagesRouter);
  return app;
}

function start() {
  const app = createApp();
  const server = app.listen(cfg.port, cfg.host, () => {
    console.log(`[server] http://${cfg.host}:${cfg.port} 에서 대시보드 대기 중`);
  });
  return server;
}

module.exports = { createApp, start };
