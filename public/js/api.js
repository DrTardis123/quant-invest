// API 응답 정규화 헬퍼
// 로컬: { ok, rows: [...] } 형태
// 호스팅(Vercel rewrite): [...] 또는 { sectors, markets } 등 직접 형태
// → 둘 다 받아서 rows/객체 추출
// + 10초 timeout (네트워크 끊김 시 무한 대기 방지)

window.apiGet = async function (url, ms = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!resp.ok) return { __error: `HTTP ${resp.status} ${resp.statusText}` };
    const r = await resp.json();
    if (Array.isArray(r)) return r;
    if (r && r.ok === false) return { __error: r.error || 'API 오류' };
    return r || {};
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return { __error: '요청 시간 초과 (10초)' };
    return { __error: e.message || '네트워크 오류' };
  }
};
