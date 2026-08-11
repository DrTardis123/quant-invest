'use strict';

const cfg = require('../config');
const naver = require('./naver');
const kis = require('./kis');

function getClient() {
  if (cfg.data.source === 'kis' && cfg.isKisEnabled()) return kis;
  return naver;
}

async function listStocks(market) {
  return getClient().listStocks(market);
}

async function getDailyPrices(code, opts) {
  return getClient().getDailyPrices(code, opts);
}

async function getFinance(code) {
  return getClient().getFinance(code);
}

async function getInvestorFlow(code, opts) {
  return getClient().getInvestorFlow(code, opts);
}

async function getRealtime(code) {
  return getClient().getRealtime(code);
}

async function getRealtimeBatch(codes) {
  return getClient().getRealtimeBatch(codes);
}

module.exports = {
  listStocks, getDailyPrices, getFinance, getInvestorFlow,
  getRealtime, getRealtimeBatch, getClient,
};
