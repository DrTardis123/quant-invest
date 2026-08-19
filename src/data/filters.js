'use strict';
// 종목 필터: ETF/ETN/리츠/인버스/레버리지/SPAC/우선주 자동 제외

// isExcludedProduct (정확한 패턴, src/factors/index.js 사용) - 7팩터 점수 계산용
// 일반 종목 prefix("삼성", "KB")도 ETF로 잘못 제외할 수 있음
const { isExcludedProduct } = require('../../src/factors');

// lightIsExcludedProduct (정확한 패턴만) - 매트릭스/신호 검증용
// ETF/ETN/우선주/SPAC/리츠/인버스/레버리지만 제외 (정확한 키워드)
function lightIsExcludedProduct(name) {
  if (!name) return false;
  const n = String(name).trim();
  if (!n) return false;
  // 1) ETN
  if (/\bETN\b/.test(n)) return true;
  // 2) 인버스/레버리지/2X/3X
  if (/(인버스|레버리지|2X|3X|2x|3x|Lever|Inverse)/.test(n)) return true;
  // 3) SPAC
  if (/(스팩|기업인수목적)/.test(n)) return true;
  // 4) 우선주: 끝 글자 '우' (한국어/영문/숫자/하이픈 직전)
  if (/[가-힣A-Za-z0-9\-\.]우$/.test(n)) return true;
  // 5) 리츠
  if (/(리츠|REITs)/.test(n)) return true;
  // 6) 명확한 ETF prefix (브랜드) - A1 보강: PLUS/KIWOOM/TIME/에셋/마이티/우리원 등
  if (/^(KODEX|TIGER|KBSTAR|ARIRANG|KINDEX|SOL|ACE|RISE|HANARO|TIMEFOLIO|마이티|TREX|우리\s*ETF|파워|WON|FOCUS|흥국|Smart|BNK|히어로즈|MASEC|KActive|일임|파인더|KIWOOM|PLUS|TIME|에셋|TIGER\s*미국|TIGER\s*S&P|TIGER\s*글로벌|마이티\s*미국|마이티\s*인버스)/.test(n)) return true;
  // 7) ETF 일반 키워드 (이름에 포함되면 매트릭스 제외)
  if (/(에셋\s*플러스|마이티\s*고배당|마이티\s*인버스|KIWOOM\s*미국|PLUS\s*고배당|PLUS\s*미국|PLUS\s*한국|TIME\s*글로벌|TIME\s*미국|TREX\s*펀더멘탈)/.test(n)) return true;
  // 8) 합성/액티브 키워드 (ETF 신호)
  if (/(합성\s*인덱스|합성\s*H|액티브\s*ETF|인덱스펀드|원유\s*ETF|금\s*ETF|채권\s*ETF)/.test(n)) return true;
  return false;
}

module.exports = { isExcludedProduct, lightIsExcludedProduct };
