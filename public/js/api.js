// API 응답 정규화 헬퍼
// 로컬: { ok, rows: [...] } 형태
// 호스팅(Vercel rewrite): [...] 또는 { sectors, markets } 등 직접 형태
// → 둘 다 받아서 rows/객체 추출

window.apiGet = async function (url) {
  const r = await fetch(url).then((r) => r.json());
  // 배열이면 그대로 반환
  if (Array.isArray(r)) return r;
  // 객체면 ok 체크 (로컬은 ok 가 false 면 에러 응답)
  if (r && r.ok === false) return { __error: r.error || 'API 오류' };
  // 정상 응답은 그대로 반환
  return r || {};
};
