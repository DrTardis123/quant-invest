'use strict';
// 종목 필터: ETF/ETN/리츠/인버스/레버리지/SPAC/우선주 자동 제외
// (cycle 회피: factors/index.js에 의존 안 함)

// isExcludedProduct: src/factors/index.js의 함수 (정확한 패턴, 광범위)
// 참고: '삼성' / 'KB' / '한투' 같은 일반 prefix도 매칭
function isExcludedProduct(name) {
  if (!name) return false;
  const n = String(name).trim();
  const nCompact = n.replace(/\s/g, '');
  if (/(KODEX|TIGER|KBSTAR|ARIRANG|KINDEX|SOL|MiraeAsset|한투|미래에셋|삼성|KB|신한|한국투자|BNK|히어로즈|TRUE|ACE|RISE|WOORI|KIWOOM|HANARO|하나|대신|교보|KYG|MASEC|Smart|마이티|KActive|타임폴리오|비트코인|이더리움|트래시|파인더|퀀트|PLUS|레버리지|인버스|선물|ETN|합성|액티브|2X|3X|레버|인버|WON|원\s*미국|파워|마이티|SOLACTIVE|인덱스펀드|인덱스\s*펀드|채권\s*ETF|원유\s*ETF|금\s*ETF|원자재|글로벌\s*X|GlobalX)/.test(n)) return true;
  if (/WON|파워|액티브|Active|TIMEFOLIO|마이티|Mighty|파워|다올|일임|인덱스펀드|원\s*지수|원\s*인덱스|채권|원유|금\s*선물|합성\s*인덱스/.test(n)) return true;
  if (/(레버리지|인버스|2X|3X|2x|3x|Lever|Inverse|2\s*배|3\s*배)/.test(n)) return true;
  if (/(스팩|기업인수목적|제\d+호|호\s*스팩)/.test(n)) return true;
  if (/[가-힣A-Za-z0-9\-\.]우$/.test(nCompact)) return true;
  if (/ETN$/.test(nCompact) || /\(H\)$/.test(nCompact)) return true;
  if (/1X|1x|인버스X|인버스2X|인버스3X|레버리지2X|레버리지3X/.test(n)) return true;
  return false;
}

// lightIsExcludedProduct: 매트릭스/신호 검증용 (정확한 키워드, 더 좁음)
// '삼성' 같은 일반 prefix는 매칭 안 함 (오탐 방지)
function lightIsExcludedProduct(name) {
  if (!name) return false;
  const n = String(name).trim();
  if (!n) return false;
  if (/\bETN\b/.test(n)) return true;
  if (/(인버스|레버리지|2X|3X|2x|3x|Lever|Inverse)/.test(n)) return true;
  if (/(스팩|기업인수목적)/.test(n)) return true;
  if (/[가-힣A-Za-z0-9\-\.]우$/.test(n)) return true;
  if (/(리츠|REITs)/.test(n)) return true;
  if (/^(KODEX|TIGER|KBSTAR|ARIRANG|KINDEX|SOL|ACE|RISE|HANARO|TIMEFOLIO|마이티|TREX|우리\s*ETF|파워|WON|FOCUS|흥국|Smart|BNK|히어로즈|MASEC|KActive|일임|파인더|KIWOOM|PLUS|TIME|에셋|TIGER\s*미국|TIGER\s*S&P|TIGER\s*글로벌|마이티\s*미국|마이티\s*인버스|KCGI|KoAct|KRX\s*메가|슈로더|미래에셋\s*미국|미래에셋\s*글로벌)/.test(n)) return true;
  if (/(에셋\s*플러스|마이티\s*고배당|마이티\s*인버스|KIWOOM\s*미국|PLUS\s*고배당|PLUS\s*미국|PLUS\s*한국|TIME\s*글로벌|TIME\s*미국|TREX\s*펀더멘탈|KCGI\s*미국|KCGI\s*글로벌|KoAct\s*미국|타임폴리오|미래에셋\s*인버스|미래에셋\s*액티브|미래에셋\s*고배당)/.test(n)) return true;
  if (/(합성\s*인덱스|합성\s*H|액티브\s*ETF|인덱스펀드|원유\s*ETF|금\s*ETF|채권\s*ETF|액티브|미국\s*천연가스|미국\s*치매|미국\s*TOP10)/.test(n)) return true;
  return false;
}

module.exports = { isExcludedProduct, lightIsExcludedProduct };
