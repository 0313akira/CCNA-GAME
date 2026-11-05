/* =========================================================================
 * app.js — 画面・ターミナル・トポロジ描画・進行管理
 * ========================================================================= */
(function () {
  'use strict';
  const NC = window.NC;
  const LEVELS = NC.LEVELS;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const STORE = 'ncq-progress-v1';
  const TA_LIMIT = 600; // タイムアタックの制限時間 (秒)
  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const shuffle = (a) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };

  // ------------------------------------------------------------ progress
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveProgress() {
    try {
      localStorage.setItem(STORE, JSON.stringify(progress));
    } catch (e) {
      /* プライベートモード等では保存しない */
    }
  }
  let progress = loadProgress();
  let S = null; // 現在のゲーム状態

  const missionLabel = (idx) => (LEVELS[idx].tutorial ? 'TUTORIAL' : 'MISSION ' + String(idx).padStart(2, '0'));

  // ------------------------------------------------------------ home
  function starsHtml(n) {
    let s = '';
    for (let k = 0; k < 3; k++) s += k < n ? '★' : '<span class="off">★</span>';
    return s;
  }
  function renderHome() {
    const list = $('#level-list');
    list.innerHTML = '';
    // チュートリアル
    const tutIdx = LEVELS.findIndex((L) => L.tutorial);
    if (tutIdx >= 0) {
      const T = LEVELS[tutIdx];
      const done = progress[T.id];
      const b = document.createElement('button');
      b.className = 'tut-card' + (done ? ' cleared' : '');
      b.innerHTML =
        '<span class="tut-icon">▶</span><div><div class="no">はじめての方へ</div><h3>' + esc(T.title) + '</h3>' +
        '<p>モードの移動・? ヘルプ・省略形など、CLI の基本操作を 3 分で体験します。</p></div>' +
        (done ? '<span class="stars">' + starsHtml(done.stars) + '</span>' : '<span class="go">はじめる →</span>');
      b.addEventListener('click', () => startMission(tutIdx));
      list.appendChild(b);
    }
    let chapter = null,
      cards = null;
    LEVELS.forEach((L, idx) => {
      if (L.tutorial) return;
      if (L.chapter !== chapter) {
        chapter = L.chapter;
        const h = document.createElement('div');
        h.className = 'chapter-head';
        h.textContent = chapter;
        list.appendChild(h);
        cards = document.createElement('div');
        cards.className = 'cards';
        list.appendChild(cards);
      }
      const p = progress[L.id];
      const b = document.createElement('button');
      b.className = 'card' + (p ? ' cleared' : '');
      b.innerHTML =
        '<div class="no">' + missionLabel(idx) + '</div>' +
        '<h3>' + esc(L.title) + '</h3>' +
        '<div class="meta"><span>難易度 ' + '■'.repeat(L.difficulty) + '<span style="opacity:.3">' + '■'.repeat(3 - L.difficulty) + '</span></span>' +
        '<span class="stars">' + starsHtml(p ? p.stars : 0) + '</span></div>';
      b.addEventListener('click', () => startMission(idx));
      cards.appendChild(b);
    });
    // トレーニング
    const h = document.createElement('div');
    h.className = 'chapter-head';
    h.textContent = 'トレーニング (何度でも遊べる)';
    list.appendChild(h);
    const modes = document.createElement('div');
    modes.className = 'cards modes';
    const rt = progress.__rt || { count: 0 };
    const ta = progress.__ta || null;
    const sn = progress.__subnet || null;
    const mode = (icon, title, desc, meta, fn) => {
      const b = document.createElement('button');
      b.className = 'card mode';
      b.innerHTML = '<div class="mode-icon">' + icon + '</div><h3>' + title + '</h3><p>' + desc + '</p><div class="meta"><span>' + meta + '</span></div>';
      b.addEventListener('click', fn);
      modes.appendChild(b);
    };
    mode('🎲', 'ランダム障害対応', '毎回ちがう 2〜3 か所の設定ミスを探して直す。制限時間なし。', '解決 ' + rt.count + ' 回', () => startRandom(false));
    mode('⏱', 'タイムアタック', '3 か所の障害を ' + TA_LIMIT / 60 + ' 分以内に直せ！ 試験本番の時間配分の練習に。', ta ? 'ベスト ' + mmss(ta.best) : '記録なし', () => startRandom(true));
    mode('🧮', 'サブネット道場', 'ネットワークアドレス・ホスト数・ワイルドカードなどの計算 10 問。', sn ? 'ベスト ' + sn.best + '/10 (' + mmss(sn.time) + ')' : '記録なし', startSubnet);
    list.appendChild(modes);

    const missions = LEVELS.filter((L) => !L.tutorial);
    const cleared = missions.filter((L) => progress[L.id]).length;
    $('#stat-clear').textContent = cleared;
    $('#stat-stars').textContent = missions.reduce((a, L) => a + (progress[L.id] ? progress[L.id].stars : 0), 0);
    $('#stat-total').textContent = missions.length;
  }
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ level
  function startMission(idx) {
    startLevel(LEVELS[idx], { idx, kind: 'mission' });
  }
  function startRandom(timed) {
    const L = NC.TROUBLE.makeTroubleLevel(timed ? { count: 3, timeLimit: TA_LIMIT } : { count: Math.random() < 0.5 ? 2 : 3 });
    startLevel(L, { idx: null, kind: timed ? 'ta' : 'random' });
  }

  function startLevel(L, opt, keepFlags) {
    stopTimer();
    const net = NC.buildLevel(L);
    const prev = S;
    S = {
      idx: opt.idx,
      kind: opt.kind,
      level: L,
      net,
      terms: {},
      cur: L.start || L.devices[0].id,
      done: NC.evaluate(L, net),
      hintsUsed: keepFlags && prev ? prev.hintsUsed : 0,
      answerViewed: keepFlags && prev ? prev.answerViewed : false,
      start: keepFlags && prev ? prev.start : Date.now(),
      cleared: false,
      over: false,
      anim: 0,
    };
    for (const d of L.devices) {
      const dev = net.devices[d.id];
      const t = { session: NC.newSession(net, d.id), lines: [], hist: [], hidx: -1 };
      if (NC.isHost(dev)) {
        t.lines.push({ c: 'sys', t: 'NetConfig PC Command Line 1.0\nhelp でコマンド一覧を表示します。\n' });
      } else {
        t.lines.push({ c: '', t: '\n' + dev.hostname + ' con0 is now available\n\nPress RETURN to get started.\n' });
        if (dev.locked) t.lines.push({ c: 'sys', t: '※ このルーターは ISP 管理のため設定変更できません (show / ping は可能)\n' });
      }
      S.terms[d.id] = t;
    }
    S.terms[S.cur].lines.push({ c: 'sys', t: 'ヒント: ? でヘルプ / Tab で補完 / ↑↓ で履歴\n' });
    $('#lv-chapter').textContent = (opt.kind === 'mission' ? missionLabel(opt.idx) : 'TRAINING') + ' · ' + L.chapter;
    $('#lv-title').textContent = L.title;
    $('#lv-story').innerHTML = L.story;
    $('#hints').innerHTML = '';
    for (let k = 0; k < S.hintsUsed; k++) appendHint(k);
    updateHintBtn();
    show('game');
    renderObjectives(true);
    renderTopo();
    renderTabs();
    renderTerm();
    startTimer();
    focusInput();
  }

  // ------------------------------------------------------------ objectives
  function renderObjectives(initial) {
    const ul = $('#objectives');
    const L = S.level;
    if (initial || ul.children.length !== L.objectives.length) {
      ul.innerHTML = '';
      L.objectives.forEach((o) => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="box">✓</span><span class="txt">' + o.text + (o.expectFail ? ' <span class="tag">通信不可を確認</span>' : '') + '</span>';
        ul.appendChild(li);
      });
    }
    S.done.forEach((v, k) => ul.children[k].classList.toggle('done', v));
    $('#obj-count').textContent = S.done.filter(Boolean).length + ' / ' + S.done.length;
  }
  function evaluate() {
    const now = NC.evaluate(S.level, S.net);
    const ul = $('#objectives');
    now.forEach((v, k) => {
      if (v && !S.done[k]) {
        const li = ul.children[k];
        li.classList.remove('flash');
        void li.offsetWidth;
        li.classList.add('flash');
      }
    });
    S.done = now;
    renderObjectives(false);
    if (!S.cleared && !S.over && now.every(Boolean)) {
      S.cleared = true;
      S.clearSecs = Math.floor((Date.now() - S.start) / 1000);
      stopTimer();
      setTimeout(showClear, 900);
    }
  }

  // ------------------------------------------------------------ timer
  let timerId = null;
  function startTimer() {
    stopTimer();
    const lim = S.level.timeLimit;
    const el = $('#timer');
    const tick = () => {
      const s = Math.floor((Date.now() - S.start) / 1000);
      if (lim) {
        const left = Math.max(0, lim - s);
        el.textContent = '残り ' + mmss(left);
        el.classList.toggle('warn', left <= 60);
        if (left <= 0 && !S.cleared && !S.over) {
          S.over = true;
          stopTimer();
          showTimeUp();
        }
      } else {
        el.textContent = mmss(s);
        el.classList.remove('warn');
      }
    };
    tick();
    timerId = setInterval(tick, 1000);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  // ------------------------------------------------------------ topology
  const R = { router: 30, switch: 34, pc: 28, server: 28 };
  function iconSvg(type) {
    switch (type) {
      case 'router':
        return (
          '<ellipse cx="0" cy="6" rx="30" ry="12" fill="#1d4ed8"/>' +
          '<rect x="-30" y="-8" width="60" height="14" fill="#2563eb"/>' +
          '<ellipse cx="0" cy="-8" rx="30" ry="12" fill="#3b82f6" stroke="#93c5fd" stroke-width="1"/>' +
          '<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M-14 -12 l8 3 M-14 -12 l3 -6"/><path d="M14 -4 l-8 -3 M14 -4 l-3 6"/>' +
          '<path d="M-3 -16 l6 -2 l-1 6"/><path d="M3 0 l-6 2 l1 -6"/></g>'
        );
      case 'switch':
        return (
          '<rect x="-34" y="-16" width="68" height="32" rx="5" fill="#0e7490" stroke="#67e8f9" stroke-width="1"/>' +
          '<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M-20 -6 h28 m-5 -4 l5 4 l-5 4"/><path d="M20 6 h-28 m5 -4 l-5 4 l5 4"/></g>'
        );
      case 'server':
        return (
          '<rect x="-18" y="-26" width="36" height="52" rx="4" fill="#334155" stroke="#94a3b8" stroke-width="1"/>' +
          '<g fill="#64748b"><rect x="-12" y="-19" width="24" height="5" rx="1"/><rect x="-12" y="-9" width="24" height="5" rx="1"/><rect x="-12" y="1" width="24" height="5" rx="1"/></g>' +
          '<circle cx="8" cy="16" r="2.5" fill="#34d399"/>'
        );
      default:
        return (
          '<rect x="-26" y="-22" width="52" height="34" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>' +
          '<rect x="-21" y="-17" width="42" height="24" fill="#0ea5e9" opacity=".55"/>' +
          '<path d="M-6 12 h12 l3 8 h-18 z" fill="#64748b"/><rect x="-16" y="20" width="32" height="4" rx="2" fill="#94a3b8"/>'
        );
    }
  }
  function portColor(net, d, i) {
    if (i.shutdown) return 'var(--admin)';
    if (!NC.linkUp(d, i)) return 'var(--down)';
    if (NC.portBlocked(net, d, i)) return 'var(--blk)';
    return 'var(--ok)';
  }
  function pcLabel(d) {
    const i = d.ifaces.FastEthernet0;
    if (i.ip != null) return NC.ip.intToIp(i.ip) + '/' + NC.ip.maskToPrefix(i.mask);
    if (i.ip6) return NC.ip6.ip6Str(i.ip6.addr) + '/' + i.ip6.plen;
    return 'IP 未設定';
  }
  function renderTopo() {
    const net = S.net,
      L = S.level;
    const svg = $('#topo');
    let links = '',
      labels = '',
      devs = '',
      bundles = '';
    // 同じ機器ペア間の複数リンクは少しずらして描く
    const pairCount = new Map(),
      pairIdx = new Map();
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    for (const [a, , b] of net.links) pairCount.set(pairKey(a, b), (pairCount.get(pairKey(a, b)) || 0) + 1);
    const bundledPairs = new Set();
    for (const [a, ai, b, bi] of net.links) {
      const A = net.devices[a],
        B = net.devices[b];
      const IA = A.ifaces[ai],
        IB = B.ifaces[bi];
      const key = pairKey(a, b);
      const m = pairCount.get(key);
      const k = pairIdx.get(key) || 0;
      pairIdx.set(key, k + 1);
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const ux = (B.x - A.x) / len,
        uy = (B.y - A.y) / len;
      const off = (k - (m - 1) / 2) * 16 * (a < b ? 1 : -1);
      const x1 = A.x - uy * off,
        y1 = A.y + ux * off,
        x2 = B.x - uy * off,
        y2 = B.y + ux * off;
      const up = NC.linkUp(A, IA);
      const trunk = NC.opMode(A, IA) === 'trunk' || NC.opMode(B, IB) === 'trunk';
      const color = trunk ? '#a78bfa' : up ? '#5b7bb5' : '#36415e';
      links += '<line class="link' + (trunk && up ? ' trunk' : '') + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + color + '"/>';
      if (m > 1 && NC.bundleOf(A, IA) && !bundledPairs.has(key)) {
        bundledPairs.add(key);
        const mx = (A.x + B.x) / 2,
          my = (A.y + B.y) / 2,
          ang = (Math.atan2(uy, ux) * 180) / Math.PI;
        bundles +=
          '<ellipse cx="' + mx + '" cy="' + my + '" rx="16" ry="' + (10 + m * 8) + '" transform="rotate(' + ang + ' ' + mx + ' ' + my + ')" fill="none" stroke="#fbbf24" stroke-width="2"/>' +
          '<text class="port-label" x="' + mx + '" y="' + (my - 18 - m * 8) + '" text-anchor="middle" style="fill:#fbbf24">' + esc(NC.ifname.shortIf(NC.bundleOf(A, IA).name)) + '</text>';
      }
      const ends = [
        [A, IA, x1, y1, 1, R[A.type]],
        [B, IB, x2, y2, -1, R[B.type]],
      ];
      for (const [D, I, x, y, s, r] of ends) {
        const dx = x + ux * s * (r + 12),
          dy = y + uy * s * (r + 12);
        labels += '<circle class="port-dot" cx="' + dx + '" cy="' + dy + '" r="5.5" fill="' + portColor(net, D, I) + '"/>';
        const side = m > 1 ? Math.sign(off) || 1 : 1;
        const lx = x + ux * s * (r + 30) - uy * 13 * side,
          ly = y + uy * s * (r + 30) + ux * 13 * side + 4;
        labels += '<text class="port-label" x="' + lx + '" y="' + ly + '" text-anchor="middle">' + esc(NC.ifname.shortIf(I.name)) + '</text>';
      }
    }
    for (const spec of L.devices) {
      const d = net.devices[spec.id];
      const r = R[d.type];
      const sub = NC.isHost(d) ? pcLabel(d) : '';
      devs +=
        '<g class="dev' + (S.cur === d.id ? ' sel' : '') + '" data-id="' + d.id + '" transform="translate(' + d.x + ',' + d.y + ')">' +
        '<circle class="halo" r="' + (r + 10) + '"/>' +
        iconSvg(d.type) +
        '<text class="dev-label" y="' + (r + 22) + '">' + esc(devName(d)) + (d.locked ? ' 🔒' : '') + '</text>' +
        (sub ? '<text class="dev-sub" y="' + (r + 37) + '">' + esc(sub) + '</text>' : '') +
        '</g>';
    }
    svg.innerHTML = '<g>' + links + '</g><g>' + bundles + '</g><g>' + labels + '</g><g>' + devs + '</g><g id="anim"></g>';
    svg.querySelectorAll('.dev').forEach((g) => g.addEventListener('click', () => selectDevice(g.dataset.id)));
  }

  /** ping のパケットアニメーション */
  function animatePing(ev) {
    const token = ++S.anim;
    const layer = $('#anim');
    if (!layer) return;
    layer.innerHTML = '';
    const pts = (path) => path.map((id) => S.net.devices[id]).filter(Boolean).map((d) => [d.x, d.y]);
    const legs = [];
    if (ev.fwd.length > 1) legs.push({ p: pts(ev.fwd), color: '#38bdf8' });
    if (ev.ok && ev.rev.length > 1) legs.push({ p: pts(ev.rev), color: '#34d399' });
    const ns = 'http://www.w3.org/2000/svg';
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '8');
    dot.setAttribute('class', 'packet');
    layer.appendChild(dot);
    const segMs = 230;
    let leg = 0,
      seg = 0,
      t0 = performance.now();
    const fail = () => {
      const last = ev.fwd.length ? S.net.devices[ev.fwd[ev.fwd.length - 1]] : null;
      dot.remove();
      if (!last) return;
      const x = document.createElementNS(ns, 'text');
      x.setAttribute('x', last.x + 26);
      x.setAttribute('y', last.y - 22);
      x.setAttribute('font-size', '30');
      x.setAttribute('fill', '#f87171');
      x.setAttribute('font-weight', '800');
      x.textContent = '✕';
      layer.appendChild(x);
      setTimeout(() => x.remove(), 1400);
    };
    if (!legs.length) return void (ev.ok ? dot.remove() : fail());
    function frame(now) {
      if (token !== S.anim) return;
      const L = legs[leg];
      const p = L.p;
      let k = (now - t0) / segMs;
      if (k >= 1) {
        seg++;
        t0 = now;
        k = 0;
        if (seg >= p.length - 1) {
          leg++;
          seg = 0;
          if (leg >= legs.length) {
            if (ev.ok) dot.remove();
            else fail();
            return;
          }
          return requestAnimationFrame(frame);
        }
      }
      const a = p[seg],
        b = p[seg + 1];
      dot.setAttribute('cx', a[0] + (b[0] - a[0]) * k);
      dot.setAttribute('cy', a[1] + (b[1] - a[1]) * k);
      dot.setAttribute('fill', L.color);
      dot.style.color = L.color;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ terminal
  function renderTabs() {
    const tabs = $('#tabs');
    tabs.innerHTML = '';
    const icon = { router: '◉', switch: '▤', pc: '▭', server: '▥' };
    for (const spec of S.level.devices) {
      const d = S.net.devices[spec.id];
      const b = document.createElement('button');
      b.className = 'tab' + (S.cur === d.id ? ' active' : '');
      b.innerHTML = '<span class="ti">' + icon[d.type] + '</span>' + esc(devName(d));
      b.addEventListener('click', () => selectDevice(d.id, true));
      tabs.appendChild(b);
    }
  }
  function classify(line) {
    if (/^\s*\^\s*$/.test(line) || /^%(?!LINK|LINEPROTO|OSPF|SYS|Warning|Portfast)/.test(line) || /^(Request timed out|Reply from .*unreachable|DHCP request failed|IPv6 autoconfiguration failed|Invalid [Cc]ommand)/.test(line)) return 'err';
    if (/^\*\w{3} .*%/.test(line) || /^%(Warning|Portfast)/.test(line)) return 'log';
    if (/^[!.U]*!+[!.]*$/.test(line) || /^Success rate is [1-9]/.test(line) || /^Reply from .*TTL/.test(line) || /^(DHCP request successful|IPv6 autoconfiguration successful)|^\[OK\]/.test(line)) return 'ok';
    return '';
  }
  function pushOut(id, text, cls) {
    const t = S.terms[id];
    if (text === '' || text == null) return;
    const lines = String(text).split('\n');
    const chunks = [];
    for (const l of lines) chunks.push({ c: cls != null ? cls : classify(l), t: l + '\n' });
    t.lines.push(...chunks);
    if (t.lines.length > 1500) t.lines.splice(0, t.lines.length - 1500);
    if (id === S.cur) {
      const out = $('#term-out');
      const frag = document.createDocumentFragment();
      for (const ch of chunks) frag.appendChild(span(ch));
      out.appendChild(frag);
      scrollTerm();
    }
  }
  function span(ch) {
    const s = document.createElement('span');
    if (ch.c) s.className = ch.c;
    s.textContent = ch.t;
    return s;
  }
  function renderTerm() {
    const t = S.terms[S.cur];
    const out = $('#term-out');
    out.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const ch of t.lines) frag.appendChild(span(ch));
    out.appendChild(frag);
    updatePrompt();
    scrollTerm();
  }
  function updatePrompt() {
    const t = S.terms[S.cur];
    $('#prompt').textContent = t.session.prompt();
    $('#cmd').classList.toggle('secret', t.session.secretInput);
  }
  function scrollTerm() {
    const term = $('#term');
    term.scrollTop = term.scrollHeight;
  }
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  function focusInput() {
    if (isMobile()) return; // モバイルでは勝手にキーボードを出さない
    $('#cmd').focus();
  }
  function selectDevice(id, fromTab) {
    if (!S.terms[id]) return;
    S.cur = id;
    renderTabs();
    renderTerm();
    renderTopo();
    $('#cmd').value = '';
    if (!isMobile()) $('#cmd').focus({ preventScroll: true });
    else if (!fromTab) $('.term-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); // スマホではターミナルまでスクロール
  }
  /** 表示名: ホスト名が ID と違うときは「Router (R1)」のように両方を出す */
  function devName(d) {
    if (NC.isHost(d) || d.hostname === d.id) return d.id;
    return d.hostname + ' (' + d.id + ')';
  }

  /** コマンド実行 (ユーザー入力・自動入力の共通処理) */
  function runCommand(id, line) {
    const t = S.terms[id];
    const sess = t.session;
    const secret = sess.secretInput;
    pushOut(id, sess.prompt() + (secret ? '' : line), 'cmdline');
    if (!secret && line.trim()) {
      t.hist.push(line);
      t.hidx = -1;
    }
    const before = NC.snapshot(S.net);
    const r = sess.exec(line);
    // IP を持たない DHCP クライアントは自動で再試行
    const got = NC.dhcpRetry(S.net);
    const after = NC.snapshot(S.net);
    if (r.out) pushOut(id, r.out);
    if (r.tip) pushOut(id, '💡 ' + r.tip, 'tip');
    const logs = NC.diffLogs(S.net, before, after);
    for (const [did, lines] of Object.entries(logs)) if (S.terms[did]) pushOut(did, lines.join('\n'), 'log');
    for (const pid of got) if (S.terms[pid]) pushOut(pid, 'DHCP: IP アドレス ' + NC.ip.intToIp(S.net.devices[pid].ifaces.FastEthernet0.ip) + ' を自動取得しました', 'ok');
    for (const ev of r.events) {
      if (ev.type === 'ping') animatePing(ev);
      if (ev.type === 'clear' && id === S.cur) {
        t.lines = [];
        renderTerm();
      }
      if (ev.type === 'reload') t.session = NC.newSession(S.net, id); // デバイスが置き換わるのでセッションを作り直す
    }
    if (id === S.cur) updatePrompt();
    renderTopo();
    renderTabs();
    evaluate();
  }

  function onKey(e) {
    const input = $('#cmd');
    const t = S && S.terms[S.cur];
    if (!t) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      runCommand(S.cur, v);
    } else if (e.key === '?' && !t.session.secretInput) {
      e.preventDefault();
      const v = input.value;
      pushOut(S.cur, t.session.prompt() + v + '?', 'cmdline');
      pushOut(S.cur, t.session.help(v), '');
      evaluate();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      input.value = t.session.complete(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!t.hist.length) return;
      t.hidx = t.hidx < 0 ? t.hist.length - 1 : Math.max(0, t.hidx - 1);
      input.value = t.hist[t.hidx];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (t.hidx < 0) return;
      t.hidx++;
      if (t.hidx >= t.hist.length) {
        t.hidx = -1;
        input.value = '';
      } else input.value = t.hist[t.hidx];
    } else if (e.ctrlKey && (e.key === 'z' || e.key === 'c')) {
      e.preventDefault();
      ctrlZ();
    }
  }
  function ctrlZ() {
    const t = S.terms[S.cur];
    const s = t.session;
    if (!(s instanceof NC.IosSession)) return;
    $('#cmd').value = '';
    if (s.pending) {
      pushOut(S.cur, s.prompt() + '^C', 'cmdline');
      s.pending = null;
    } else if (s.mode !== 'user' && s.mode !== 'priv') {
      pushOut(S.cur, s.prompt() + '^Z', 'cmdline');
      s.mode = 'priv';
      s.ctx = {};
      S.net.seen.add(S.cur + ':back');
      S.net.seen.add(S.cur + ':mode:priv');
    }
    updatePrompt();
    evaluate();
  }

  // ------------------------------------------------------------ hints / modal
  function appendHint(k) {
    const d = document.createElement('div');
    d.className = 'hint';
    d.innerHTML = '<b class="hn">ヒント ' + (k + 1) + '</b>' + S.level.hints[k];
    $('#hints').appendChild(d);
  }
  function updateHintBtn() {
    const n = S.level.hints.length;
    const b = $('#btn-hint');
    b.textContent = '💡 ヒント ' + S.hintsUsed + '/' + n;
    b.disabled = S.hintsUsed >= n;
    b.style.opacity = b.disabled ? 0.5 : 1;
  }
  function showModal(html, onReady) {
    $('#modal-body').innerHTML = html;
    $('#modal-bg').classList.add('show');
    $('#modal').scrollTop = 0;
    if (onReady) onReady($('#modal-body'));
  }
  function closeModal() {
    $('#modal-bg').classList.remove('show');
    if (S && $('#game').classList.contains('active')) focusInput();
  }
  function confirmModal(title, msg, okText, fn) {
    showModal('<h2>' + title + '</h2><p>' + msg + '</p><div class="row"><button class="btn" data-a="no">キャンセル</button><button class="btn primary" data-a="ok">' + okText + '</button></div>', (m) => {
      m.querySelector('[data-a=no]').onclick = closeModal;
      m.querySelector('[data-a=ok]').onclick = () => {
        closeModal();
        fn();
      };
    });
  }

  function showAnswer() {
    const L = S.level;
    let html = '<h2>🔑 解答例</h2><p style="color:var(--muted);font-size:13px">一例です。同じ結果になれば別の書き方でも OK。「自動入力」で各機器に順番に投入します。</p>';
    if (L.random) html += '<div class="lesson">' + L.lesson.explain + '</div>';
    for (const [id, cmds] of Object.entries(L.solution)) {
      const d = S.net.devices[id];
      html += '<h3>' + esc(NC.isHost(d) ? id : id + ' (' + d.hostname + ')') + '</h3><pre>' + esc(cmds.filter((c) => c !== '').join('\n')) + '</pre>';
    }
    html += '<div class="row"><button class="btn" data-a="close">閉じる</button><button class="btn primary" data-a="auto">▶ 自動入力</button></div>';
    showModal(html, (m) => {
      m.querySelector('[data-a=close]').onclick = closeModal;
      m.querySelector('[data-a=auto]').onclick = () => {
        closeModal();
        autoType();
      };
    });
  }
  async function autoType() {
    const L = S.level;
    const token = S;
    for (const [id, cmds] of Object.entries(L.solution)) {
      selectDevice(id);
      const sess = S.terms[id].session;
      if (sess instanceof NC.IosSession && sess.mode !== 'user') {
        if (sess.mode !== 'priv') runCommand(id, 'end');
        runCommand(id, 'disable');
      }
      for (const c of cmds) {
        await new Promise((r) => setTimeout(r, 140));
        if (S !== token || S.cur !== id) return;
        runCommand(id, c);
      }
    }
  }

  /** 解説とクイズ */
  function lessonHtml(L) {
    const ls = L.lesson || NC.LESSONS[L.id];
    if (!ls) return '';
    let html = '<div class="lesson"><h3>📘 解説: なぜそうなる？</h3><div>' + ls.explain + '</div></div>';
    if (ls.quiz && ls.quiz.length) {
      html += '<div class="quiz"><h3>✏️ 確認クイズ</h3>';
      ls.quiz.forEach((q, qi) => {
        const order = shuffle(q.c.map((c, i) => i));
        html +=
          '<div class="quiz-q" data-q="' + qi + '"><p><b>Q' + (qi + 1) + '.</b> ' + esc(q.q) + '</p><div class="choices">' +
          order.map((i) => '<button class="btn choice" data-i="' + i + '">' + esc(q.c[i]) + '</button>').join('') +
          '</div><div class="why"></div></div>';
      });
      html += '</div>';
    }
    return html;
  }
  function wireQuiz(m, L) {
    const ls = L.lesson || NC.LESSONS[L.id];
    if (!ls || !ls.quiz) return;
    m.querySelectorAll('.quiz-q').forEach((box) => {
      const q = ls.quiz[Number(box.dataset.q)];
      box.querySelectorAll('.choice').forEach((b) =>
        b.addEventListener('click', () => {
          if (box.classList.contains('answered')) return;
          box.classList.add('answered');
          const ok = Number(b.dataset.i) === q.a;
          b.classList.add(ok ? 'right' : 'wrong');
          box.querySelectorAll('.choice').forEach((x) => {
            if (Number(x.dataset.i) === q.a) x.classList.add('right');
          });
          box.querySelector('.why').innerHTML = (ok ? '<b class="okc">⭕ 正解！</b> ' : '<b class="ngc">❌ 不正解</b> ') + esc(q.why);
        })
      );
    });
  }

  function showClear() {
    const L = S.level;
    const secs = S.clearSecs;
    let head = '',
      buttons = '',
      extra = '';
    if (S.kind === 'mission') {
      const stars = S.answerViewed ? 1 : S.hintsUsed > 0 ? 2 : 3;
      const prev = progress[L.id];
      if (!prev || stars > prev.stars || (stars === prev.stars && secs < prev.time)) progress[L.id] = { stars, time: secs };
      const next = S.idx + 1 < LEVELS.length;
      head =
        '<div style="font-size:13px;color:var(--muted)">' + missionLabel(S.idx) + '</div><div class="big">' + (L.tutorial ? 'TUTORIAL CLEAR!' : 'MISSION CLEAR!') + '</div>' +
        '<div class="stars">' + [0, 1, 2].map((k) => (k < stars ? '<span>★</span>' : '<span class="off">★</span>')).join('') + '</div>' +
        '<div class="sub">タイム ' + mmss(secs) + (S.hintsUsed ? ' ・ ヒント ' + S.hintsUsed + ' 回' : '') + (S.answerViewed ? ' ・ 解答例を参照' : '') + '</div>';
      if (!next) extra = '<p>🎉 全ミッション完了！ トレーニングモードで腕を磨きましょう。</p>';
      extra += '<div class="learned"><b>このミッションで学んだこと</b><ul>' + L.learn.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
      buttons = '<button class="btn" data-a="stay">このまま続ける</button><button class="btn" data-a="home">ミッション一覧</button>' + (next ? '<button class="btn primary" data-a="next">次のミッションへ →</button>' : '');
    } else {
      let rec = '';
      if (S.kind === 'ta') {
        const ta = progress.__ta;
        if (!S.answerViewed && (!ta || secs < ta.best)) {
          progress.__ta = { best: secs };
          rec = ' <span class="rec">新記録！</span>';
        }
      }
      if (!S.answerViewed) progress.__rt = { count: ((progress.__rt && progress.__rt.count) || 0) + 1 };
      head =
        '<div style="font-size:13px;color:var(--muted)">TRAINING</div><div class="big">' + (S.kind === 'ta' ? 'TIME ATTACK CLEAR!' : 'ALL FIXED!') + '</div>' +
        '<div class="sub">タイム ' + mmss(secs) + rec + (S.kind === 'ta' ? ' (残り ' + mmss(L.timeLimit - secs) + ')' : '') + (S.answerViewed ? ' ・ 解答例を参照 (記録なし)' : '') + '</div>';
      buttons = '<button class="btn" data-a="stay">このまま続ける</button><button class="btn" data-a="home">ホームへ</button><button class="btn primary" data-a="again">新しい問題に挑戦 →</button>';
    }
    saveProgress();
    const html = '<div class="clear-box">' + head + '</div>' + extra + lessonHtml(L) + '<div class="row">' + buttons + '</div>';
    showModal(html, (m) => {
      wireQuiz(m, L);
      m.querySelector('[data-a=stay]').onclick = closeModal;
      m.querySelector('[data-a=home]').onclick = () => {
        closeModal();
        goHome();
      };
      const nx = m.querySelector('[data-a=next]');
      if (nx)
        nx.onclick = () => {
          closeModal();
          startMission(S.idx + 1);
        };
      const ag = m.querySelector('[data-a=again]');
      if (ag)
        ag.onclick = () => {
          closeModal();
          startRandom(S.kind === 'ta');
        };
    });
  }

  function showTimeUp() {
    const L = S.level;
    const n = S.done.filter(Boolean).length;
    const html =
      '<div class="clear-box"><div class="big ng">TIME UP</div><div class="sub">達成した目標 ' + n + ' / ' + S.done.length + '</div></div>' +
      lessonHtml(L) +
      '<div class="row"><button class="btn" data-a="stay">練習として続ける</button><button class="btn" data-a="home">ホームへ</button><button class="btn primary" data-a="again">もう一度挑戦 →</button></div>';
    showModal(html, (m) => {
      m.querySelector('[data-a=stay]').onclick = () => {
        $('#timer').textContent = '練習中';
        closeModal();
      };
      m.querySelector('[data-a=home]').onclick = () => {
        closeModal();
        goHome();
      };
      m.querySelector('[data-a=again]').onclick = () => {
        closeModal();
        startRandom(true);
      };
    });
  }

  function showCheat() {
    let html = '<h2>📖 コマンド早見表</h2><div class="cheat">';
    for (const sec of NC.CHEATSHEET) {
      html += '<h3>' + esc(sec.title) + '</h3>';
      if (sec.modes) html += '<div class="modes">' + esc(sec.modes) + '</div>';
      html += '<table>' + sec.rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>';
    }
    html += '</div><div class="row"><button class="btn" data-a="close">閉じる</button></div>';
    showModal(html, (m) => (m.querySelector('[data-a=close]').onclick = closeModal));
  }

  function goHome() {
    stopTimer();
    subnetStop();
    if (S) S.anim++;
    S = null;
    renderHome();
    show('home');
  }

  // ------------------------------------------------------------ subnet dojo
  const SN_COUNT = 10;
  let SN = null,
    snTimer = null;
  function subnetStop() {
    if (snTimer) clearInterval(snTimer);
    snTimer = null;
  }
  function startSubnet() {
    subnetStop();
    SN = { qs: NC.SUBNET.makeRound(SN_COUNT, Math.floor(Math.random() * 1e9)), k: 0, score: 0, start: Date.now(), answered: false };
    show('subnet');
    snTimer = setInterval(() => ($('#sn-timer').textContent = mmss((Date.now() - SN.start) / 1000)), 1000);
    $('#sn-timer').textContent = '00:00';
    renderSubnetQ();
  }
  function renderSubnetQ() {
    const q = SN.qs[SN.k];
    SN.answered = false;
    $('#sn-progress').textContent = 'Q' + (SN.k + 1) + ' / ' + SN_COUNT;
    $('#sn-score').textContent = '正解 ' + SN.score;
    $('#sn-bar').style.width = (SN.k / SN_COUNT) * 100 + '%';
    const box = $('#sn-card');
    let html = '<div class="sn-q">' + q.q + '</div>';
    if (q.choices) html += '<div class="sn-choices">' + q.choices.map((c) => '<button class="btn sn-choice" data-v="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>';
    else html += '<div class="sn-input"><input id="sn-ans" autocomplete="off" inputmode="decimal" placeholder="' + esc(q.ph || '') + '"/><button class="btn primary" id="sn-check">判定</button></div>';
    html += '<div class="sn-fb" id="sn-fb"></div>';
    box.innerHTML = html;
    if (q.choices) box.querySelectorAll('.sn-choice').forEach((b) => b.addEventListener('click', () => judgeSubnet(b.dataset.v)));
    else {
      const inp = $('#sn-ans');
      $('#sn-check').onclick = () => judgeSubnet(inp.value);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (SN.answered) nextSubnet();
          else judgeSubnet(inp.value);
        }
      });
      if (!isMobile()) inp.focus();
    }
  }
  function judgeSubnet(v) {
    if (SN.answered) return;
    if (!String(v).trim()) return;
    SN.answered = true;
    const q = SN.qs[SN.k];
    const ok = NC.SUBNET.isCorrect(q, v);
    if (ok) SN.score++;
    $('#sn-score').textContent = '正解 ' + SN.score;
    document.querySelectorAll('.sn-choice').forEach((b) => {
      b.disabled = true;
      if (b.dataset.v === q.answers[0]) b.classList.add('right');
      else if (b.dataset.v === v) b.classList.add('wrong');
    });
    const inp = $('#sn-ans');
    if (inp) inp.classList.add(ok ? 'right' : 'wrong');
    const last = SN.k + 1 >= SN_COUNT;
    $('#sn-fb').innerHTML =
      (ok ? '<div class="okc big2">⭕ 正解！</div>' : '<div class="ngc big2">❌ 不正解 — 正解は <code>' + esc(q.answers[0]) + '</code></div>') +
      '<div class="sn-explain">' + q.explain + '</div>' +
      '<button class="btn primary" id="sn-next">' + (last ? '結果を見る' : '次の問題 →') + '</button>';
    $('#sn-next').onclick = nextSubnet;
    if (!inp) $('#sn-next').focus();
    else setTimeout(() => inp.focus(), 0);
  }
  function nextSubnet() {
    SN.k++;
    if (SN.k < SN_COUNT) return renderSubnetQ();
    subnetStop();
    const secs = Math.floor((Date.now() - SN.start) / 1000);
    const best = progress.__subnet;
    let rec = '';
    if (!best || SN.score > best.best || (SN.score === best.best && secs < best.time)) {
      progress.__subnet = { best: SN.score, time: secs };
      saveProgress();
      rec = '<span class="rec">新記録！</span>';
    }
    $('#sn-bar').style.width = '100%';
    const rank = SN.score === 10 ? '🏆 師範' : SN.score >= 8 ? '🥋 黒帯' : SN.score >= 5 ? '🟫 茶帯' : '⬜ 白帯';
    $('#sn-card').innerHTML =
      '<div class="clear-box"><div class="big">' + SN.score + ' / ' + SN_COUNT + '</div><div class="sn-rank">' + rank + '</div><div class="sub">タイム ' + mmss(secs) + ' ' + rec + '</div></div>' +
      '<div class="row center"><button class="btn" id="sn-home">ホームへ</button><button class="btn primary" id="sn-again">もう一度</button></div>';
    $('#sn-home').onclick = goHome;
    $('#sn-again').onclick = startSubnet;
  }

  // ------------------------------------------------------------ wiring
  function init() {
    renderHome();
    $('#cmd').addEventListener('keydown', onKey);
    $('#term').addEventListener('mouseup', () => {
      if (!String(window.getSelection())) $('#cmd').focus({ preventScroll: true });
    });
    $('#btn-back').onclick = goHome;
    $('#sn-back').onclick = goHome;
    $('#btn-hint').onclick = () => {
      if (S.hintsUsed >= S.level.hints.length) return;
      appendHint(S.hintsUsed);
      S.hintsUsed++;
      updateHintBtn();
      const sc = document.querySelector('.mission-scroll');
      sc.scrollTop = sc.scrollHeight;
    };
    $('#btn-answer').onclick = () => {
      if (S.answerViewed) return showAnswer();
      const msg = S.kind === 'mission' ? '解答例を見ると、このミッションの獲得スターは最大 ★1 になります。' : '解答例を見ると、今回の記録は残りません。';
      confirmModal('解答例を表示しますか？', msg, '表示する', () => {
        S.answerViewed = true;
        showAnswer();
      });
    };
    $('#btn-reset').onclick = () =>
      confirmModal('リセットしますか？', 'すべての機器の設定が最初の状態に戻ります (タイマーは継続)。', 'リセット', () => startLevel(S.level, { idx: S.idx, kind: S.kind }, true));
    $('#btn-cheat').onclick = showCheat;
    $('#btn-cheat-home').onclick = showCheat;
    $('#btn-reset-progress').onclick = () =>
      confirmModal('進捗をリセットしますか？', 'すべてのクリア記録・スター・ベスト記録が消去されます。', 'リセット', () => {
        progress = {};
        saveProgress();
        renderHome();
      });
    $('#modal-x').onclick = closeModal;
    $('#modal-bg').addEventListener('click', (e) => {
      if (e.target.id === 'modal-bg') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#modal-bg').classList.contains('show')) closeModal();
    });
    document.querySelectorAll('.keybar button').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.key;
        const input = $('#cmd');
        if (k === 'ctrlz') return ctrlZ();
        if (k === 'clear') {
          S.terms[S.cur].lines = [];
          return renderTerm();
        }
        onKey({ key: k, preventDefault() {}, ctrlKey: false });
        input.focus({ preventScroll: true });
      })
    );
  }
  init();
})();
