/* =========================================================================
 * subnet.js — サブネット道場 (サブネット計算の問題ジェネレーター)
 *   問題: { q, answers: [正解として受け付ける文字列], choices?, explain, hint }
 * ========================================================================= */
(function (G) {
  'use strict';
  const NC = G.NC;
  const { intToIp, prefixToMask } = NC.ip;

  function rint(r, a, b) {
    return a + Math.floor(r() * (b - a + 1));
  }
  // 計算が面白い (オクテットの途中で切れる) プレフィックス
  const PFX = [17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30];

  function randIp(r, p) {
    const first = [10, 172, 192][rint(r, 0, 2)];
    const o2 = first === 172 ? rint(r, 16, 31) : first === 192 ? 168 : rint(r, 0, 255);
    void p;
    return ((first << 24) | (o2 << 16) | (rint(r, 0, 255) << 8) | rint(r, 1, 254)) >>> 0;
  }
  /** ブロックサイズ法での解説 */
  function blockExplain(ip, p) {
    const mask = prefixToMask(p);
    const k = Math.floor(p / 8); // 注目するオクテット (0 始まり)
    const mo = (mask >>> (24 - 8 * k)) & 255;
    const block = 256 - mo;
    const val = (ip >>> (24 - 8 * k)) & 255;
    const start = Math.floor(val / block) * block;
    const net = (ip & mask) >>> 0;
    const bc = (net | ~mask) >>> 0;
    const name = ['第1', '第2', '第3', '第4'][k];
    return {
      net,
      bc,
      text:
        '/' + p + ' = ' + intToIp(mask) + '。注目するのは' + name + 'オクテット (マスク ' + mo + ')。<br>' +
        'ブロックサイズ = 256 − ' + mo + ' = <b>' + block + '</b>。' + val + ' を含む範囲は <b>' + start + '〜' + (start + block - 1) + '</b>。<br>' +
        '→ ネットワーク <b>' + intToIp(net) + '</b> / ブロードキャスト <b>' + intToIp(bc) + '</b> / 使えるホスト ' + intToIp(net + 1) + '〜' + intToIp(bc - 1),
    };
  }

  const TYPES = [
    // ネットワークアドレス
    (r) => {
      const p = PFX[rint(r, 0, PFX.length - 1)];
      const ip = randIp(r, p);
      const e = blockExplain(ip, p);
      return { q: '<code>' + intToIp(ip) + '/' + p + '</code> の<b>ネットワークアドレス</b>は？', answers: [intToIp(e.net)], explain: e.text, ph: '例: 192.168.1.0' };
    },
    // ブロードキャスト
    (r) => {
      const p = PFX[rint(r, 0, PFX.length - 1)];
      const ip = randIp(r, p);
      const e = blockExplain(ip, p);
      return { q: '<code>' + intToIp(ip) + '/' + p + '</code> の<b>ブロードキャストアドレス</b>は？', answers: [intToIp(e.bc)], explain: e.text, ph: '例: 192.168.1.255' };
    },
    // 最初 / 最後のホスト
    (r) => {
      const p = PFX[rint(r, 4, PFX.length - 1)];
      const ip = randIp(r, p);
      const e = blockExplain(ip, p);
      const last = r() < 0.5;
      return {
        q: '<code>' + intToIp(ip) + '/' + p + '</code> で使える<b>' + (last ? '最後' : '最初') + 'のホストアドレス</b>は？',
        answers: [intToIp(last ? e.bc - 1 : e.net + 1)],
        explain: e.text + '<br>最初のホスト = ネットワーク + 1、最後のホスト = ブロードキャスト − 1',
        ph: '例: 192.168.1.1',
      };
    },
    // ホスト数
    (r) => {
      const p = rint(r, 20, 30);
      const n = Math.pow(2, 32 - p) - 2;
      return {
        q: '<code>/' + p + '</code> のサブネットで<b>使えるホストの数</b>は？',
        answers: [String(n)],
        explain: 'ホスト部 = 32 − ' + p + ' = ' + (32 - p) + ' ビット。2<sup>' + (32 - p) + '</sup> − 2 = <b>' + n + '</b> (ネットワークとブロードキャストの 2 つを引く)',
        ph: '数字',
      };
    },
    // 必要ホスト数 → プレフィックス
    (r) => {
      const need = [2, 5, 10, 14, 20, 25, 30, 50, 60, 100, 120, 200, 250, 300, 500, 1000][rint(r, 0, 15)];
      let h = 2;
      while (Math.pow(2, h) - 2 < need) h++;
      const p = 32 - h;
      return {
        q: 'ホストが <b>' + need + ' 台</b>必要。アドレスの無駄が最も少ないサブネットマスクは？ (/表記)',
        answers: ['/' + p, String(p), intToIp(prefixToMask(p))],
        explain: '2<sup>h</sup> − 2 ≥ ' + need + ' となる最小の h は ' + h + ' (2<sup>' + h + '</sup> − 2 = ' + (Math.pow(2, h) - 2) + ')。<br>プレフィックス = 32 − ' + h + ' = <b>/' + p + '</b> (' + intToIp(prefixToMask(p)) + ')',
        ph: '例: /26',
      };
    },
    // プレフィックス → マスク
    (r) => {
      const p = rint(r, 8, 30);
      return {
        q: '<code>/' + p + '</code> を<b>ドット表記のサブネットマスク</b>にすると？',
        answers: [intToIp(prefixToMask(p))],
        explain: '先頭から ' + p + ' ビットが 1。8 ビットごとに区切ると <b>' + intToIp(prefixToMask(p)) + '</b>。<br>覚え方: 128, 192, 224, 240, 248, 252, 254, 255',
        ph: '例: 255.255.255.0',
      };
    },
    // マスク → ワイルドカード
    (r) => {
      const p = PFX[rint(r, 0, PFX.length - 1)];
      const m = prefixToMask(p);
      const wc = ~m >>> 0;
      return {
        q: 'サブネットマスク <code>' + intToIp(m) + '</code> の<b>ワイルドカードマスク</b> (ACL・OSPF で使用) は？',
        answers: [intToIp(wc)],
        explain: '各オクテットを 255 から引きます: 255.255.255.255 − ' + intToIp(m) + ' = <b>' + intToIp(wc) + '</b>',
        ph: '例: 0.0.0.255',
      };
    },
    // 同じサブネット？
    (r) => {
      const p = PFX[rint(r, 4, PFX.length - 1)];
      const a = randIp(r, p);
      const mask = prefixToMask(p);
      const same = r() < 0.5;
      const k = Math.floor(p / 8);
      const block = 256 - ((mask >>> (24 - 8 * k)) & 255);
      let b;
      if (same) b = ((a & mask) | (rint(r, 1, Math.pow(2, 32 - p) - 2) >>> 0)) >>> 0;
      else b = (a + block * Math.pow(2, 24 - 8 * k) * (r() < 0.5 ? 1 : -1)) >>> 0;
      const ans = ((a ^ b) & mask) === 0;
      const e = blockExplain(a, p);
      return {
        q: '<code>' + intToIp(a) + '/' + p + '</code> と <code>' + intToIp(b) + '</code> は<b>同じサブネット</b>？',
        choices: ['はい', 'いいえ'],
        answers: [ans ? 'はい' : 'いいえ'],
        explain: e.text + '<br>' + intToIp(b) + ' はこの範囲に' + (ans ? '<b>含まれる</b> → 同じサブネット' : '<b>含まれない</b> → 別のサブネット'),
      };
    },
  ];

  function makeRound(n, seed) {
    let x = seed >>> 0 || 7;
    const r = () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return x / 4294967296;
    };
    const qs = [];
    for (let k = 0; k < n; k++) qs.push(TYPES[k % TYPES.length === 0 ? rint(r, 0, TYPES.length - 1) : rint(r, 0, TYPES.length - 1)](r));
    return qs;
  }
  function normalize(s) {
    return String(s).trim().replace(/\s+/g, '').replace(/[．。]/g, '.').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/／/g, '/');
  }
  function isCorrect(q, input) {
    const v = normalize(input);
    return q.answers.some((a) => normalize(a) === v);
  }

  NC.SUBNET = { makeRound, isCorrect, TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
