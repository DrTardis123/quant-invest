// Dark mode + sidebar injection
// — 페이지 로드 시 사이드바를 만들고 body에 has-sidebar 클래스 추가
// — 활성 메뉴 하이라이트
// — 모바일 토글

(function () {
  'use strict';

  // 현재 경로 → 활성 메뉴 키
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const tab = new URL(window.location.href).searchParams.get('tab') || '';

  let activeKey = 'home';
  if (path === '/' || path === '/index.html') {
    if (tab === 'portfolio') activeKey = 'portfolio';
    else if (tab === 'signals') activeKey = 'signals';
    else if (tab === 'transactions') activeKey = 'transactions';
    else if (tab === 'backtest') activeKey = 'backtest';
    else if (tab === 'matrix') activeKey = 'matrix';
    else if (tab === 'regime') activeKey = 'regime';
    else activeKey = 'home';
  } else if (path === '/explore' || path === '/explore.html') activeKey = 'explore';
  else if (path === '/analysis' || path === '/analysis.html') activeKey = 'analysis';

  const NAV = [
    { section: 'Overview' },
    { key: 'home',         label: '메인',        icon: '▦', href: '/' },
    { key: 'portfolio',    label: '포트폴리오',  icon: '💼', href: '/?tab=portfolio' },
    { key: 'signals',      label: '신호',        icon: '📡', href: '/?tab=signals' },
    { key: 'transactions', label: '매매',        icon: '💱', href: '/?tab=transactions' },

    { section: 'Analyze' },
    { key: 'analysis',     label: '분석',        icon: '📊', href: '/analysis' },
    { key: 'backtest',     label: '백테스트',    icon: '⏪', href: '/?tab=backtest' },
    { key: 'matrix',       label: '매트릭스',    icon: '🎯', href: '/?tab=matrix' },
    { key: 'regime',       label: '시장평가',    icon: '🌐', href: '/?tab=regime' },

    { section: 'Tools' },
    { key: 'explore',      label: '탐색',        icon: '🔍', href: '/explore' },
  ];

  // 사이드바 HTML
  const sidebar = document.createElement('nav');
  sidebar.className = 'ds-sidebar';
  sidebar.setAttribute('aria-label', '메인 네비게이션');
  sidebar.innerHTML = `
    <div class="ds-logo">
      <div class="ds-logo-icon">📈</div>
      <span>퀀트 투자</span>
    </div>
    ${NAV.map((n) => {
      if (n.section) return `<div class="ds-nav-section">${n.section}</div>`;
      const active = n.key === activeKey ? ' active' : '';
      return `<a class="ds-nav-item${active}" href="${n.href}">
        <span class="ds-nav-icon">${n.icon}</span> ${n.label}
      </a>`;
    }).join('')}
  `;

  // 모바일 토글 버튼
  const toggle = document.createElement('button');
  toggle.className = 'ds-sidebar-toggle';
  toggle.setAttribute('aria-label', '사이드바 열기/닫기');
  toggle.innerHTML = '☰';
  toggle.addEventListener('click', () => sidebar.classList.toggle('open'));

  // body에 클래스 + 사이드바/토글 삽입
  document.body.classList.add('has-sidebar');
  document.body.insertBefore(sidebar, document.body.firstChild);
  document.body.insertBefore(toggle, document.body.firstChild);
})();
