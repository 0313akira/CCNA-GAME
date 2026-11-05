/* =========================================================================
 * random.js — ランダム障害対応 / タイムアタックの問題ジェネレーター
 *   正しく動くネットワークに、故障パターンをランダムにいくつか仕込む
 * ========================================================================= */
(function (G) {
  'use strict';
  const NC = G.NC;

  // ---- 正常な設定 (この状態ならすべての ping が通る)
  const BASE = {
    S1: [
      'hostname S1', 'vlan 10', 'name SALES', 'vlan 20', 'name STAFF',
      'interface fa0/1', 'switchport mode access', 'switchport access vlan 10',
      'interface fa0/2', 'switchport mode access', 'switchport access vlan 20',
      'interface g0/1', 'switchport trunk allowed vlan 10,20', 'switchport mode trunk',
    ],
    R1: [
      'hostname R1', 'interface g0/0', 'no shutdown',
      'interface g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0',
      'interface g0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0',
      'interface g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      'ip dhcp excluded-address 192.168.20.1 192.168.20.10',
      'ip dhcp pool STAFF', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1',
      'router ospf 1', 'router-id 1.1.1.1',
      'network 192.168.10.0 0.0.0.255 area 0', 'network 192.168.20.0 0.0.0.255 area 0', 'network 10.0.0.0 0.0.0.3 area 0',
    ],
    R2: [
      'hostname R2', 'interface g0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown',
      'interface g0/1', 'ip address 172.16.1.1 255.255.255.0', 'no shutdown',
      'router ospf 1', 'router-id 2.2.2.2', 'network 10.0.0.0 0.0.0.3 area 0', 'network 172.16.1.0 0.0.0.255 area 0',
    ],
    SRV: ['ipconfig 172.16.1.100 255.255.255.0 172.16.1.1'],
    PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'],
    PC2: ['ipconfig /dhcp'],
  };
  const ORDER = ['S1', 'R1', 'R2', 'SRV', 'PC1', 'PC2'];

  // ---- 行操作ヘルパー
  function replaceAfter(lines, anchor, oldL, newL) {
    const a = anchor ? lines.indexOf(anchor) : 0;
    if (a < 0) throw new Error('anchor ' + anchor);
    const k = lines.indexOf(oldL, a);
    if (k < 0) throw new Error('line ' + oldL);
    lines[k] = newL;
  }
  function insertAfter(lines, anchor, add) {
    const a = lines.indexOf(anchor);
    if (a < 0) throw new Error('anchor ' + anchor);
    lines.splice(a + 1, 0, ...add);
  }
  const cfg = (...l) => ['enable', 'configure terminal', ...l, 'end'];

  // ---- 故障パターン
  //   group が同じものは同時に選ばない (同じ行を書き換えるため)
  const FAULTS = [
    {
      id: 'pc1-vlan', group: 's1-fa1', layer: 'L2',
      cause: 'S1 の Fa0/1 (PC1) が VLAN 20 に所属していた',
      apply: (c) => replaceAfter(c.S1, 'interface fa0/1', 'switchport access vlan 10', 'switchport access vlan 20'),
      fix: { S1: cfg('interface fa0/1', 'switchport access vlan 10') },
    },
    {
      id: 'trunk-mode', group: 's1-g01', layer: 'L2',
      cause: 'S1 の Gi0/1 (R1 向け) がトランクではなくアクセスポートになっていた',
      apply: (c) => replaceAfter(c.S1, 'interface g0/1', 'switchport mode trunk', 'switchport mode access'),
      fix: { S1: cfg('interface g0/1', 'switchport mode trunk') },
    },
    {
      id: 'trunk-allowed', group: 's1-allowed', layer: 'L2',
      cause: 'S1 のトランクで VLAN 20 が許可されていなかった',
      apply: (c) => replaceAfter(c.S1, 'interface g0/1', 'switchport trunk allowed vlan 10,20', 'switchport trunk allowed vlan 10'),
      fix: { S1: cfg('interface g0/1', 'switchport trunk allowed vlan 10,20') },
    },
    {
      id: 'r1-g00-shut', group: 'r1-g00', layer: 'L1',
      cause: 'R1 の G0/0 (S1 向けの親インターフェース) が shutdown されていた',
      apply: (c) => replaceAfter(c.R1, 'interface g0/0', 'no shutdown', 'shutdown'),
      fix: { R1: cfg('interface g0/0', 'no shutdown') },
    },
    {
      id: 'r1-encap', group: 'r1-sub10', layer: 'L2',
      cause: 'R1 の G0/0.10 が dot1Q 11 になっていて、VLAN 10 のタグと一致していなかった',
      apply: (c) => replaceAfter(c.R1, 'interface g0/0.10', 'encapsulation dot1Q 10', 'encapsulation dot1Q 11'),
      fix: { R1: cfg('interface g0/0.10', 'encapsulation dot1Q 10') },
    },
    {
      id: 'r1-sub20-ip', group: 'r1-sub20', layer: 'L3',
      cause: 'R1 の G0/0.20 の IP が 192.168.21.1 になっていた (PC2 のゲートウェイ・DHCP プールと不一致)',
      apply: (c) => replaceAfter(c.R1, 'interface g0/0.20', 'ip address 192.168.20.1 255.255.255.0', 'ip address 192.168.21.1 255.255.255.0'),
      fix: { R1: cfg('interface g0/0.20', 'ip address 192.168.20.1 255.255.255.0'), PC2: ['ipconfig /dhcp'] },
    },
    {
      id: 'r1-g01-shut', group: 'r1-g01', layer: 'L1',
      cause: 'R1 の G0/1 (R2 向け) が shutdown されていた',
      apply: (c) => replaceAfter(c.R1, 'interface g0/1', 'no shutdown', 'shutdown'),
      fix: { R1: cfg('interface g0/1', 'no shutdown') },
    },
    {
      id: 'r2-area', group: 'r2-net10', layer: 'ルーティング',
      cause: 'R2 の OSPF で R1 との間のネットワークがエリア 1 になっていた (エリア不一致でネイバーにならない)',
      apply: (c) => replaceAfter(c.R2, 'router ospf 1', 'network 10.0.0.0 0.0.0.3 area 0', 'network 10.0.0.0 0.0.0.3 area 1'),
      fix: { R2: cfg('router ospf 1', 'no network 10.0.0.0 0.0.0.3 area 1', 'network 10.0.0.0 0.0.0.3 area 0') },
    },
    {
      id: 'r1-passive', group: 'r1-passive', layer: 'ルーティング',
      cause: 'R1 の OSPF で G0/1 (R2 向け) が passive-interface になっていた (Hello が送られずネイバーにならない)',
      apply: (c) => insertAfter(c.R1, 'router-id 1.1.1.1', ['passive-interface g0/1']),
      fix: { R1: cfg('router ospf 1', 'no passive-interface g0/1') },
    },
    {
      id: 'r2-no-lan', group: 'r2-net172', layer: 'ルーティング',
      cause: 'R2 がサーバー LAN (172.16.1.0/24) を OSPF で広報していなかった',
      apply: (c) => c.R2.splice(c.R2.indexOf('network 172.16.1.0 0.0.0.255 area 0'), 1),
      fix: { R2: cfg('router ospf 1', 'network 172.16.1.0 0.0.0.255 area 0') },
    },
    {
      id: 'srv-gw', group: 'srv', layer: 'L3',
      cause: 'SRV のデフォルトゲートウェイが 172.16.1.254 (存在しないアドレス) になっていた',
      apply: (c) => (c.SRV[0] = 'ipconfig 172.16.1.100 255.255.255.0 172.16.1.254'),
      fix: { SRV: ['ipconfig 172.16.1.100 255.255.255.0 172.16.1.1'] },
    },
    {
      id: 'pc1-gw', group: 'pc1', layer: 'L3',
      cause: 'PC1 のデフォルトゲートウェイが 192.168.10.254 (存在しないアドレス) になっていた',
      apply: (c) => (c.PC1[0] = 'ipconfig 192.168.10.10 255.255.255.0 192.168.10.254'),
      fix: { PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'] },
    },
    {
      id: 'pc1-mask', group: 'pc1', layer: 'L3',
      cause: 'PC1 のサブネットマスクが 255.255.0.0 になっていて、PC2 (192.168.20.x) を同じネットワークだと勘違いしていた',
      apply: (c) => (c.PC1[0] = 'ipconfig 192.168.10.10 255.255.0.0 192.168.10.1'),
      fix: { PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'] },
    },
    {
      id: 'dhcp-gw', group: 'dhcp-router', layer: 'サービス',
      cause: 'DHCP プール STAFF の default-router が 192.168.20.254 になっていて、PC2 に間違ったゲートウェイが配られていた',
      apply: (c) => replaceAfter(c.R1, 'ip dhcp pool STAFF', 'default-router 192.168.20.1', 'default-router 192.168.20.254'),
      fix: { R1: cfg('ip dhcp pool STAFF', 'default-router 192.168.20.1'), PC2: ['ipconfig /dhcp'] },
    },
    {
      id: 'dhcp-excluded', group: 'dhcp-excl', layer: 'サービス',
      cause: 'DHCP の除外範囲が 192.168.20.1〜254 (全部) になっていて、PC2 に配るアドレスがなかった',
      apply: (c) => replaceAfter(c.R1, null, 'ip dhcp excluded-address 192.168.20.1 192.168.20.10', 'ip dhcp excluded-address 192.168.20.1 192.168.20.254'),
      fix: { R1: cfg('no ip dhcp excluded-address 192.168.20.1 192.168.20.254', 'ip dhcp excluded-address 192.168.20.1 192.168.20.10'), PC2: ['ipconfig /dhcp'] },
    },
    {
      id: 'r2-g01-ip', group: 'r2-g01', layer: 'L3',
      cause: 'R2 の G0/1 の IP が 172.16.2.1 になっていた (サーバー LAN と別のネットワーク)',
      apply: (c) => replaceAfter(c.R2, 'interface g0/1', 'ip address 172.16.1.1 255.255.255.0', 'ip address 172.16.2.1 255.255.255.0'),
      fix: { R2: cfg('interface g0/1', 'ip address 172.16.1.1 255.255.255.0') },
    },
    {
      id: 'r2-acl', group: 'r2-acl', layer: 'セキュリティ',
      cause: 'R2 の G0/1 に ACL が適用され、VLAN 10 (PC1) からサーバーへの通信が拒否されていた',
      apply: (c) => {
        insertAfter(c.R2, 'interface g0/1', ['ip access-group 1 out']);
        c.R2.push('access-list 1 deny 192.168.10.0 0.0.0.255', 'access-list 1 permit any');
      },
      fix: { R2: cfg('interface g0/1', 'no ip access-group 1 out') },
    },
  ];

  // ---- 乱数 (シード付き)
  function rng(seed) {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return x / 4294967296;
    };
  }
  function pickFaults(n, seed) {
    const r = rng(seed);
    const pool = FAULTS.slice();
    const out = [];
    const groups = new Set();
    while (out.length < n && pool.length) {
      const k = Math.floor(r() * pool.length);
      const f = pool.splice(k, 1)[0];
      if (groups.has(f.group)) continue;
      groups.add(f.group);
      out.push(f);
    }
    return out;
  }

  /** 故障入りのレベルを作る */
  function makeTroubleLevel(opts) {
    const n = opts.count || 3;
    const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    const faults = opts.faults || pickFaults(n, seed);
    const conf = {};
    for (const k of ORDER) conf[k] = BASE[k].slice();
    for (const f of faults) f.apply(conf);
    const solution = {};
    for (const k of ORDER)
      for (const f of faults)
        if (f.fix[k]) {
          if (!solution[k]) solution[k] = [];
          solution[k].push(...f.fix[k]);
        }
    // PC2 の DHCP 更新は最後に 1 回だけ
    if (solution.PC2) solution.PC2 = ['ipconfig /dhcp'];
    const timed = !!opts.timeLimit;
    return {
      id: timed ? 'time-attack' : 'random-trouble',
      random: true,
      seed,
      faults,
      timeLimit: opts.timeLimit || 0,
      title: timed ? 'タイムアタック: 障害対応' : 'ランダム障害対応',
      chapter: 'トレーニング',
      difficulty: 3,
      story:
        (timed ? '⏱ <b>制限時間 ' + Math.round(opts.timeLimit / 60) + ' 分</b>。' : '') +
        'ネットワークに <b>' + faults.length + ' か所</b>の設定ミスが仕込まれています (毎回ランダム)。<br>show コマンド・<code>ipconfig</code>・<code>ping</code>・<code>tracert</code> で原因を探して直してください。' +
        '<table class="kv"><tr><td>VLAN 10 (PC1)</td><td>192.168.10.0/24 GW .1 (固定 IP)</td></tr><tr><td>VLAN 20 (PC2)</td><td>192.168.20.0/24 GW .1 (R1 の DHCP)</td></tr><tr><td>R1–R2</td><td>10.0.0.0/30・OSPF エリア 0</td></tr><tr><td>サーバー LAN</td><td>172.16.1.0/24 GW .1 (SRV = .100)</td></tr><tr><td>S1 Gi0/1</td><td>R1 へのトランク (VLAN 10,20)</td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 70, y: 90 },
        { id: 'PC2', type: 'pc', x: 70, y: 330 },
        { id: 'S1', type: 'switch', x: 240, y: 210 },
        { id: 'R1', type: 'router', x: 430, y: 210 },
        { id: 'R2', type: 'router', x: 620, y: 210 },
        { id: 'SRV', type: 'server', x: 790, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'R2', 'Gi0/0'],
        ['R2', 'Gi0/1', 'SRV', 'Fa0'],
      ],
      setup: conf,
      start: 'PC1',
      objectives: [
        { text: 'PC1 → SRV (172.16.1.100) に ping が通る', check: (net) => NC.checks.ping(net, 'PC1', '172.16.1.100') },
        { text: 'PC2 → SRV に ping が通る', check: (net) => NC.checks.ping(net, 'PC2', '172.16.1.100') },
        { text: 'PC1 → PC2 に ping が通る (PC2 の IP は ipconfig で確認)', check: (net) => { const a = net.devices.PC2.ifaces.FastEthernet0.ip; return a != null && NC.ping(net, net.devices.PC1, a).ok && NC.ip.inSubnet(a, NC.ip.ipToInt('192.168.20.0'), NC.ip.ipToInt('255.255.255.0')); } },
      ],
      hints: [
        'まず PC1・PC2 で <code>ipconfig</code> と <code>tracert 172.16.1.100</code>。どこまで届いているかで、壊れている場所の見当をつけます。',
        'S1: <code>show vlan brief</code> / <code>show interfaces trunk</code> で、ポートの VLAN とトランクを確認。',
        'R1・R2: <code>show ip interface brief</code> / <code>show ip ospf neighbor</code> / <code>show ip route</code> / <code>show access-lists</code> / <code>show run</code>',
        'PC2 は DHCP で IP をもらいます。DHCP やゲートウェイを直したら、PC2 で <code>ipconfig /dhcp</code> をやり直しましょう。',
      ],
      solution,
      learn: faults.map((f) => '[' + f.layer + '] ' + f.cause),
      lesson: {
        explain:
          '今回仕込まれていた障害:<ol>' + faults.map((f) => '<li><b>' + f.layer + '</b> — ' + f.cause + '</li>').join('') + '</ol>OSI の下の層 (物理 → L2 → L3 → ルーティング) から順に確認すると、早く見つけられます。',
        quiz: [],
      },
    };
  }

  NC.TROUBLE = { FAULTS, BASE, ORDER, makeTroubleLevel, pickFaults };
})(typeof window !== 'undefined' ? window : globalThis);
