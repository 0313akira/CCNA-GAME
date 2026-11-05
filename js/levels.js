/* =========================================================================
 * levels.js — ミッション定義
 *   devices : トポロジ上のデバイス (x,y は 860x420 の座標)
 *   links   : [devA, ifA, devB, ifB]
 *   setup   : 初期設定 (IOS は設定モードの行, PC は PC コマンド)
 *   objectives : 自動判定される目標
 *   solution   : 解答例 (テストでも使用)
 * ========================================================================= */
(function (G) {
  'use strict';
  const NC = G.NC;
  const ip = (s) => NC.ip.ipToInt(s);

  // ---- 判定ヘルパー
  const C = {
    dev: (n, id) => n.devices[id],
    ifc: (n, id, name) => n.devices[id].ifaces[NC.ifname.canonIf(name)],
    hostname: (n, id, h) => n.devices[id].hostname === h,
    ifIp: (n, id, name, addr, mask) => {
      const i = C.ifc(n, id, name);
      return !!i && i.ip === ip(addr) && i.mask === ip(mask);
    },
    up: (n, id, name) => {
      const i = C.ifc(n, id, name);
      return !!i && NC.ifUp(n.devices[id], i);
    },
    ping: (n, from, to) => NC.ping(n, n.devices[from], ip(to)).ok,
    pc: (n, id, addr, mask, gw) => {
      const d = n.devices[id],
        i = d.ifaces.FastEthernet0;
      return i.ip === ip(addr) && i.mask === ip(mask) && d.gateway === ip(gw);
    },
    saved: (n, id) => {
      const d = n.devices[id];
      return !!d.startup && NC.genRun(d).join('\n') === d.startup.join('\n');
    },
    route: (n, id, net, mask, code) =>
      NC.routingTable(n, n.devices[id]).some((e) => e.net === ip(net) && e.mask === ip(mask) && (!code || e.code.startsWith(code))),
    staticRoute: (n, id, net, mask, nh) =>
      n.devices[id].staticRoutes.some((r) => r.net === ip(net) && r.mask === ip(mask) && (!nh || r.nh === ip(nh))),
    vlan: (n, id, v, name) => {
      const d = n.devices[id];
      return d.vlans.has(v) && (!name || d.vlans.get(v) === name);
    },
    access: (n, id, port, v) => {
      const i = C.ifc(n, id, port);
      return i.mode === 'access' && i.accessVlan === v;
    },
    trunk: (n, id, port) => C.ifc(n, id, port).mode === 'trunk',
    native: (n, id, port, v) => C.ifc(n, id, port).nativeVlan === v,
    ospfNbrs: (n, id) => {
      const info = NC.computeOspf(n)[id];
      return info ? info.nbrs.filter((x) => x.state.startsWith('FULL')).length : 0;
    },
    rid: (n, id, r) => {
      const d = n.devices[id];
      return !!d.ospf && d.ospf.routerId === ip(r);
    },
    passive: (n, id, port) => {
      const d = n.devices[id];
      if (!d.ospf) return false;
      const name = NC.ifname.canonIf(port);
      return d.ospf.passiveDefault ? !d.ospf.noPassive.has(name) : d.ospf.passive.has(name);
    },
    seen: (n, key) => !!n.seen && n.seen.has(key),
    stpRoot: (n, id, v) => {
      const I = NC.computeStp(n, v)[id];
      return !!I && !I.rootPort && I.ports.length > 0;
    },
    stpAltn: (n, id, port, v) => NC.stpRole(n, n.devices[id], C.ifc(n, id, port), v) === 'Altn',
    noBlocked: (n, id) => {
      const d = n.devices[id];
      return NC.physPorts(d).every((p) => !NC.portBlocked(n, d, p));
    },
    v6: (n, id, name, addr, plen) => {
      const i = C.ifc(n, id, name);
      return !!i && !!i.ip6 && i.ip6.addr === NC.ip6.ip6Parse(addr) && i.ip6.plen === plen;
    },
    ping6: (n, from, to) => NC.ping(n, n.devices[from], NC.ip6.ip6Parse(to)).ok,
    /** 一時的にインターフェースを落として判定 */
    withShut: (n, id, port, fn) => {
      const i = C.ifc(n, id, port);
      const old = i.shutdown;
      i.shutdown = true;
      NC.touch(n);
      try {
        return fn();
      } finally {
        i.shutdown = old;
        NC.touch(n);
      }
    },
  };

  const LEVELS = [
    // ================================================================ 0
    {
      id: 'tutorial',
      tutorial: true,
      title: 'チュートリアル: CLI の歩き方',
      chapter: 'はじめに',
      difficulty: 1,
      story:
        'Cisco 機器はキーボードでコマンドを打って操作します。まずは<b>モード</b>の移動に慣れましょう。右のターミナルに 1 つずつ入力してみてください。<table class="kv"><tr><td><code>R1&gt;</code></td><td>ユーザー EXEC モード: 簡単な確認だけ</td></tr><tr><td><code>R1#</code></td><td>特権 EXEC モード: show・保存・再起動</td></tr><tr><td><code>R1(config)#</code></td><td>グローバル設定モード: 設定を変更</td></tr></table>便利キー: <kbd>?</kbd> ヘルプ / <kbd>Tab</kbd> 補完 / <kbd>↑</kbd> 履歴 / コマンドは <code>conf t</code> のように省略できます。',
      devices: [
        { id: 'PC1', type: 'pc', x: 220, y: 210 },
        { id: 'R1', type: 'router', x: 620, y: 210 },
      ],
      links: [['PC1', 'Fa0', 'R1', 'Gi0/0']],
      setup: { R1: ['interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown'], PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'] },
      start: 'R1',
      objectives: [
        { text: '<code>enable</code> で特権 EXEC モード (<code>Router#</code>) に入る', check: (n) => C.seen(n, 'R1:mode:priv') },
        { text: '<code>?</code> を入力して使えるコマンドの一覧を見る', check: (n) => C.seen(n, 'R1:help') },
        { text: '<code>show ip interface brief</code> でインターフェースの状態を確認', check: (n) => C.seen(n, 'R1:show') },
        { text: '<code>configure terminal</code> でグローバル設定モードに入る', check: (n) => C.seen(n, 'R1:mode:config') },
        { text: '<code>hostname MyRouter</code> でホスト名を変える', check: (n) => C.hostname(n, 'R1', 'MyRouter') },
        { text: '<code>end</code> で特権 EXEC モードに戻る', check: (n) => C.seen(n, 'R1:back') },
      ],
      hints: [
        'ターミナルの <code>Router&gt;</code> の後ろに <code>enable</code> と入力して Enter。プロンプトが <code>Router#</code> に変わります。',
        '<code>?</code> キーを押すと、その場で使えるコマンドが一覧表示されます。<code>sh?</code> のように途中まで打ってから押すと候補が絞られます。',
        '<code>configure terminal</code> (省略形 <code>conf t</code>) → <code>hostname MyRouter</code> → <code>end</code>',
      ],
      solution: { R1: ['enable', '?', 'show ip interface brief', 'configure terminal', 'hostname MyRouter', 'end'] },
      learn: ['ユーザー EXEC (>) / 特権 EXEC (#) / 設定モード (config)#', '? ヘルプと Tab 補完', 'コマンドの省略形'],
    },
    // ================================================================ 1
    {
      id: 'first-router',
      title: 'はじめてのルーター設定',
      chapter: '基本操作',
      difficulty: 1,
      story:
        'ようこそ、新人ネットワークエンジニア！ 最初の仕事は箱から出したばかりのルーター <b>R1</b> を設定して、PC1 からルーターに通信できるようにすることです。<br>トポロジ図の <b>R1</b> をクリックするとターミナルが開きます。',
      devices: [
        { id: 'PC1', type: 'pc', x: 130, y: 210 },
        { id: 'S1', type: 'switch', x: 420, y: 210 },
        { id: 'R1', type: 'router', x: 710, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
      ],
      setup: { PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'] },
      start: 'R1',
      objectives: [
        { text: 'R1 のホスト名を <code>R1</code> に変更する', check: (n) => C.hostname(n, 'R1', 'R1') },
        { text: 'R1 の G0/0 に 192.168.1.1 / 255.255.255.0 を設定', check: (n) => C.ifIp(n, 'R1', 'g0/0', '192.168.1.1', '255.255.255.0') },
        { text: 'R1 の G0/0 を有効化する (up/up)', check: (n) => C.up(n, 'R1', 'g0/0') },
        { text: 'PC1 → R1 (192.168.1.1) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.1.1') },
        { text: '設定を NVRAM に保存する (startup-config)', check: (n) => C.saved(n, 'R1') },
      ],
      hints: [
        'R1 をクリックしてターミナルを開き、<code>enable</code> で特権 EXEC モード (#)、<code>configure terminal</code> でグローバル設定モード (config)# に入ります。',
        '<code>hostname R1</code> でホスト名を変更。プロンプトが変わることを確認しましょう。',
        '<code>interface g0/0</code> → <code>ip address 192.168.1.1 255.255.255.0</code> → <code>no shutdown</code>。ルーターのインターフェースは初期状態で shutdown されています。',
        '<code>end</code> で特権モードに戻り、<code>copy running-config startup-config</code> (確認は Enter) で保存します。<code>show ip interface brief</code> で状態を確認できます。',
      ],
      solution: {
        R1: ['enable', 'configure terminal', 'hostname R1', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end', 'copy running-config startup-config', ''],
      },
      learn: ['enable / configure terminal / end', 'hostname', 'interface → ip address → no shutdown', 'show ip interface brief', 'copy running-config startup-config'],
    },
    // ================================================================ 2
    {
      id: 'pc-gateway',
      title: 'IP アドレスとデフォルトゲートウェイ',
      chapter: '基本操作',
      difficulty: 1,
      story:
        '2 つの LAN をルーター R1 でつなぎます。左の LAN は 192.168.10.0/24、右の LAN は 192.168.20.0/24 です。<br>PC の設定は PC をクリックして <code>ipconfig &lt;IP&gt; &lt;マスク&gt; &lt;GW&gt;</code> で行います。<br>さらに、<b>PC2 から右の LAN に通信できない</b>という問い合わせが来ています…。',
      devices: [
        { id: 'PC1', type: 'pc', x: 90, y: 110 },
        { id: 'PC2', type: 'pc', x: 90, y: 320 },
        { id: 'S1', type: 'switch', x: 260, y: 215 },
        { id: 'R1', type: 'router', x: 440, y: 215 },
        { id: 'S2', type: 'switch', x: 620, y: 215 },
        { id: 'PC3', type: 'pc', x: 780, y: 215 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'S2', 'Gi0/1'],
        ['S2', 'Fa0/1', 'PC3', 'Fa0'],
      ],
      setup: {
        R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown'],
        PC2: ['ipconfig 192.168.10.11 255.255.255.0 192.168.10.254'],
      },
      start: 'PC1',
      objectives: [
        { text: 'PC1 に 192.168.10.10/24、GW 192.168.10.1 を設定', check: (n) => C.pc(n, 'PC1', '192.168.10.10', '255.255.255.0', '192.168.10.1') },
        { text: 'R1 の G0/1 に 192.168.20.1/24 を設定し有効化', check: (n) => C.ifIp(n, 'R1', 'g0/1', '192.168.20.1', '255.255.255.0') && C.up(n, 'R1', 'g0/1') },
        { text: 'PC3 に 192.168.20.10/24、GW 192.168.20.1 を設定', check: (n) => C.pc(n, 'PC3', '192.168.20.10', '255.255.255.0', '192.168.20.1') },
        { text: 'PC1 → PC3 (192.168.20.10) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.20.10') },
        { text: '【障害対応】PC2 → PC3 に ping が通る', check: (n) => C.ping(n, 'PC2', '192.168.20.10') },
      ],
      hints: [
        'PC1 をクリックし <code>ipconfig 192.168.10.10 255.255.255.0 192.168.10.1</code>。引数なしの <code>ipconfig</code> で現在の設定を表示できます。',
        'R1 で <code>interface g0/1</code> → <code>ip address 192.168.20.1 255.255.255.0</code> → <code>no shutdown</code>。',
        '別のネットワークへ通信するとき、PC はデフォルトゲートウェイ (= ルーターの IP) にパケットを送ります。',
        'PC2 で <code>ipconfig</code> を実行してゲートウェイを確認してみましょう。R1 の G0/0 の IP と一致していますか？',
      ],
      solution: {
        PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'],
        R1: ['enable', 'conf t', 'interface g0/1', 'ip address 192.168.20.1 255.255.255.0', 'no shutdown', 'end'],
        PC3: ['ipconfig 192.168.20.10 255.255.255.0 192.168.20.1'],
        PC2: ['ipconfig 192.168.10.11 255.255.255.0 192.168.10.1'],
      },
      learn: ['PC の IP / マスク / デフォルトゲートウェイ', '異なるネットワーク間はルーター経由', 'ゲートウェイ誤りの切り分け'],
    },
    // ================================================================ 3
    {
      id: 'switch-svi',
      title: 'スイッチの管理 IP (SVI)',
      chapter: '基本操作',
      difficulty: 1,
      story:
        'レイヤ 2 スイッチ S1 はそのままでもフレームを転送しますが、リモート管理するには IP アドレスが必要です。<br>スイッチの IP は物理ポートではなく <b>VLAN インターフェース (SVI)</b> に設定します。別ネットワークの管理 PC <b>Admin</b> からも S1 に届くようにしましょう。',
      devices: [
        { id: 'PC1', type: 'pc', x: 100, y: 215 },
        { id: 'S1', type: 'switch', x: 310, y: 215 },
        { id: 'R1', type: 'router', x: 540, y: 215 },
        { id: 'Admin', type: 'pc', x: 760, y: 215 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'Admin', 'Fa0'],
      ],
      setup: {
        R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 172.16.99.1 255.255.255.0', 'no shutdown'],
        PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'],
        Admin: ['ipconfig 172.16.99.10 255.255.255.0 172.16.99.1'],
      },
      start: 'S1',
      objectives: [
        { text: 'S1 のホスト名を <code>S1</code> にする', check: (n) => C.hostname(n, 'S1', 'S1') },
        { text: 'S1 の Vlan1 に 192.168.1.2/24 を設定し有効化 (up/up)', check: (n) => C.ifIp(n, 'S1', 'vlan1', '192.168.1.2', '255.255.255.0') && C.up(n, 'S1', 'vlan1') },
        { text: 'PC1 → S1 (192.168.1.2) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.1.2') },
        { text: 'S1 のデフォルトゲートウェイを 192.168.1.1 に設定', check: (n) => C.dev(n, 'S1').defaultGateway === ip('192.168.1.1') },
        { text: 'Admin → S1 (192.168.1.2) に ping が通る', check: (n) => C.ping(n, 'Admin', '192.168.1.2') },
      ],
      hints: [
        '<code>interface vlan 1</code> で SVI の設定モードに入ります。',
        '<code>ip address 192.168.1.2 255.255.255.0</code> → <code>no shutdown</code>。Vlan1 も初期状態では shutdown です。',
        'L2 スイッチはルーティングしないので、他ネットワークへの返信には <code>ip default-gateway 192.168.1.1</code> (グローバル設定モード) が必要です。',
      ],
      solution: {
        S1: ['enable', 'conf t', 'hostname S1', 'interface vlan 1', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'exit', 'ip default-gateway 192.168.1.1', 'end'],
      },
      learn: ['interface vlan 1 (SVI)', 'ip default-gateway', 'L2 スイッチの管理アクセス'],
    },
    // ================================================================ 4
    {
      id: 'security',
      title: 'デバイスのセキュリティと SSH',
      chapter: '基本操作',
      difficulty: 2,
      story:
        '監査で「R1 のパスワードが未設定」と指摘されました！ 以下の値で R1 を保護し、Telnet ではなく <b>SSH</b> だけでリモートログインできるようにしてください。<br><table class="kv"><tr><td>enable secret</td><td><code>Cisco123</code></td></tr><tr><td>コンソール パスワード</td><td><code>conpass</code></td></tr><tr><td>ドメイン名</td><td><code>ccna.local</code></td></tr><tr><td>ローカルユーザー</td><td><code>admin</code> / secret <code>Admin123</code></td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 200, y: 215 },
        { id: 'R1', type: 'router', x: 600, y: 215 },
      ],
      links: [['PC1', 'Fa0', 'R1', 'Gi0/0']],
      setup: {
        R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown'],
        PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'],
      },
      start: 'R1',
      objectives: [
        { text: 'enable secret を <code>Cisco123</code> に設定', check: (n) => C.dev(n, 'R1').enableSecret === NC.secretHash('Cisco123') },
        { text: 'コンソールにパスワード <code>conpass</code> を設定し login を有効化', check: (n) => { const l = C.dev(n, 'R1').lines.con; return l.password === 'conpass' && l.login === 'password'; } },
        { text: '平文パスワードを暗号化する (service password-encryption)', check: (n) => C.dev(n, 'R1').servicePwEnc },
        { text: 'MOTD バナーを設定する (内容は自由)', check: (n) => !!(C.dev(n, 'R1').banner || '').trim() },
        { text: 'ドメイン名 <code>ccna.local</code> とユーザー <code>admin</code> (secret Admin123) を作成', check: (n) => { const d = C.dev(n, 'R1'); return d.domainName === 'ccna.local' && !!d.users.admin && d.users.admin.secret === NC.secretHash('Admin123'); } },
        { text: '1024 ビット以上の RSA 鍵を生成し SSH バージョン 2 を有効化', check: (n) => { const d = C.dev(n, 'R1'); return d.rsa >= 1024 && d.sshVersion === 2; } },
        { text: 'VTY 0-4 をローカル認証 + SSH のみに制限', check: (n) => { const l = C.dev(n, 'R1').lines.vty; return l.login === 'local' && l.transport === 'ssh'; } },
        { text: '設定を保存する', check: (n) => C.saved(n, 'R1') },
      ],
      hints: [
        '<code>enable secret Cisco123</code> は MD5 ハッシュで保存されます (<code>enable password</code> より安全)。',
        '<code>line console 0</code> → <code>password conpass</code> → <code>login</code>。最後に <code>service password-encryption</code>。',
        'バナーは区切り文字で囲みます: <code>banner motd #Authorized access only!#</code>',
        'SSH の準備: <code>ip domain-name ccna.local</code> → <code>username admin secret Admin123</code> → <code>crypto key generate rsa</code> (1024 と入力) → <code>ip ssh version 2</code>',
        '<code>line vty 0 4</code> → <code>login local</code> → <code>transport input ssh</code>。最後に保存を忘れずに！',
      ],
      solution: {
        R1: [
          'enable', 'conf t', 'enable secret Cisco123', 'line console 0', 'password conpass', 'login', 'exit', 'service password-encryption',
          'banner motd #Authorized access only!#', 'ip domain-name ccna.local', 'username admin secret Admin123', 'crypto key generate rsa', '1024',
          'ip ssh version 2', 'line vty 0 4', 'login local', 'transport input ssh', 'end', 'copy running-config startup-config', '',
        ],
      },
      learn: ['enable secret', 'line console / line vty', 'service password-encryption', 'banner motd', 'crypto key generate rsa / ip ssh version 2', 'login local / transport input ssh'],
    },
    // ================================================================ 5
    {
      id: 'vlan',
      title: 'VLAN でネットワークを分割',
      chapter: 'スイッチング',
      difficulty: 2,
      story:
        '営業部と技術部の PC が同じスイッチにつながっています。全員同じサブネット (192.168.1.0/24) ですが、<b>部署間の通信を VLAN で分離</b>せよとの指示です。<br><table class="kv"><tr><td>VLAN 10 <code>SALES</code></td><td>PC1 (Fa0/1), PC3 (Fa0/3)</td></tr><tr><td>VLAN 20 <code>ENGINEERING</code></td><td>PC2 (Fa0/2), PC4 (Fa0/4)</td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 120, y: 80 },
        { id: 'PC2', type: 'pc', x: 320, y: 80 },
        { id: 'PC3', type: 'pc', x: 540, y: 80 },
        { id: 'PC4', type: 'pc', x: 740, y: 80 },
        { id: 'S1', type: 'switch', x: 430, y: 320 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['PC3', 'Fa0', 'S1', 'Fa0/3'],
        ['PC4', 'Fa0', 'S1', 'Fa0/4'],
      ],
      setup: {
        S1: ['hostname S1'],
        PC1: ['ipconfig 192.168.1.11 255.255.255.0'],
        PC2: ['ipconfig 192.168.1.12 255.255.255.0'],
        PC3: ['ipconfig 192.168.1.13 255.255.255.0'],
        PC4: ['ipconfig 192.168.1.14 255.255.255.0'],
      },
      start: 'S1',
      objectives: [
        { text: 'VLAN 10 を名前 <code>SALES</code> で作成', check: (n) => C.vlan(n, 'S1', 10, 'SALES') },
        { text: 'VLAN 20 を名前 <code>ENGINEERING</code> で作成', check: (n) => C.vlan(n, 'S1', 20, 'ENGINEERING') },
        { text: 'Fa0/1・Fa0/3 を VLAN 10 のアクセスポートにする', check: (n) => C.access(n, 'S1', 'fa0/1', 10) && C.access(n, 'S1', 'fa0/3', 10) },
        { text: 'Fa0/2・Fa0/4 を VLAN 20 のアクセスポートにする', check: (n) => C.access(n, 'S1', 'fa0/2', 20) && C.access(n, 'S1', 'fa0/4', 20) },
        { text: 'PC1 → PC3 (同じ VLAN) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.1.13') },
        { text: 'PC2 → PC4 (同じ VLAN) に ping が通る', check: (n) => C.ping(n, 'PC2', '192.168.1.14') },
        { text: 'PC1 → PC2 (別 VLAN) は届かない', expectFail: true, check: (n) => !C.ping(n, 'PC1', '192.168.1.12') },
      ],
      hints: [
        '<code>vlan 10</code> → <code>name SALES</code> で VLAN を作成します。<code>show vlan brief</code> で確認。',
        'ポートの設定: <code>interface fa0/1</code> → <code>switchport mode access</code> → <code>switchport access vlan 10</code>',
        '複数ポートをまとめて設定するなら <code>interface range fa0/1 , fa0/3</code> が便利です。',
      ],
      solution: {
        S1: [
          'enable', 'conf t', 'vlan 10', 'name SALES', 'vlan 20', 'name ENGINEERING', 'exit',
          'interface range fa0/1 , fa0/3', 'switchport mode access', 'switchport access vlan 10',
          'interface range fa0/2 , fa0/4', 'switchport mode access', 'switchport access vlan 20', 'end',
        ],
      },
      learn: ['vlan / name', 'switchport mode access / switchport access vlan', 'interface range', 'show vlan brief'],
    },
    // ================================================================ 6
    {
      id: 'trunk',
      title: 'トランクで VLAN を延長',
      chapter: 'スイッチング',
      difficulty: 2,
      story:
        'フロアが増えて 2 台目のスイッチ <b>S2</b> を導入しました。S1 は設定済みです。S1–S2 間を <b>802.1Q トランク</b>にして、VLAN 10・20 をフロアをまたいで使えるようにしてください。<br>セキュリティのため、<b>ネイティブ VLAN は未使用の VLAN 99</b> に変更します。',
      devices: [
        { id: 'PC1', type: 'pc', x: 90, y: 80 },
        { id: 'PC2', type: 'pc', x: 330, y: 80 },
        { id: 'PC3', type: 'pc', x: 530, y: 80 },
        { id: 'PC4', type: 'pc', x: 770, y: 80 },
        { id: 'S1', type: 'switch', x: 230, y: 310 },
        { id: 'S2', type: 'switch', x: 630, y: 310 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['PC3', 'Fa0', 'S2', 'Fa0/1'],
        ['PC4', 'Fa0', 'S2', 'Fa0/2'],
        ['S1', 'Gi0/1', 'S2', 'Gi0/1'],
      ],
      setup: {
        S1: ['hostname S1', 'vlan 10', 'name SALES', 'vlan 20', 'name ENGINEERING', 'vlan 99', 'name NATIVE', 'interface fa0/1', 'switchport mode access', 'switchport access vlan 10', 'interface fa0/2', 'switchport mode access', 'switchport access vlan 20'],
        S2: ['hostname S2'],
        PC1: ['ipconfig 192.168.10.11 255.255.255.0'],
        PC2: ['ipconfig 192.168.20.11 255.255.255.0'],
        PC3: ['ipconfig 192.168.10.12 255.255.255.0'],
        PC4: ['ipconfig 192.168.20.12 255.255.255.0'],
      },
      start: 'S2',
      objectives: [
        { text: 'S2 に VLAN 10・20・99 を作成', check: (n) => [10, 20, 99].every((v) => C.vlan(n, 'S2', v)) },
        { text: 'S2 の Fa0/1 を VLAN 10、Fa0/2 を VLAN 20 のアクセスポートに', check: (n) => C.access(n, 'S2', 'fa0/1', 10) && C.access(n, 'S2', 'fa0/2', 20) },
        { text: 'S1・S2 の Gi0/1 を <code>switchport mode trunk</code> に', check: (n) => C.trunk(n, 'S1', 'gi0/1') && C.trunk(n, 'S2', 'gi0/1') },
        { text: '両側のネイティブ VLAN を 99 に変更', check: (n) => C.native(n, 'S1', 'gi0/1', 99) && C.native(n, 'S2', 'gi0/1', 99) },
        { text: 'PC1 → PC3 (VLAN 10) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.10.12') },
        { text: 'PC2 → PC4 (VLAN 20) に ping が通る', check: (n) => C.ping(n, 'PC2', '192.168.20.12') },
      ],
      hints: [
        'S1 で <code>show vlan brief</code> を実行すると、S1 の VLAN 設定を参考にできます。',
        'トランク: <code>interface g0/1</code> → <code>switchport mode trunk</code> → <code>switchport trunk native vlan 99</code> (S1・S2 両方)',
        'トランクポートは <code>show vlan brief</code> には表示されません。<code>show interfaces trunk</code> で確認しましょう。',
      ],
      solution: {
        S1: ['enable', 'conf t', 'interface g0/1', 'switchport mode trunk', 'switchport trunk native vlan 99', 'end'],
        S2: [
          'enable', 'conf t', 'vlan 10', 'name SALES', 'vlan 20', 'name ENGINEERING', 'vlan 99', 'name NATIVE',
          'interface fa0/1', 'switchport mode access', 'switchport access vlan 10',
          'interface fa0/2', 'switchport mode access', 'switchport access vlan 20',
          'interface g0/1', 'switchport mode trunk', 'switchport trunk native vlan 99', 'end',
        ],
      },
      learn: ['switchport mode trunk', 'switchport trunk native vlan', 'switchport trunk allowed vlan', 'show interfaces trunk', 'DTP (dynamic auto / desirable)'],
    },
    // ================================================================ STP
    {
      id: 'stp',
      title: 'STP でループを防ぐ',
      chapter: 'スイッチング',
      difficulty: 3,
      story:
        '冗長化のために 3 台のスイッチを三角形に接続しました。ループを防ぐため <b>STP</b> が自動で 1 つのポートをブロックしていますが、古いスイッチ S3 がルートブリッジに選ばれ、<b>コアスイッチ S1 のポートがブロック</b>されてしまっています。<br>S1 をルートブリッジ、S2 をバックアップ (セカンダリ) にして、通信を S1 中心に流しましょう。<br><small>オレンジの点 = STP でブロックされているポート</small>',
      devices: [
        { id: 'S1', type: 'switch', x: 430, y: 70 },
        { id: 'S2', type: 'switch', x: 230, y: 240 },
        { id: 'S3', type: 'switch', x: 630, y: 240 },
        { id: 'PC1', type: 'pc', x: 90, y: 340 },
        { id: 'PC2', type: 'pc', x: 770, y: 340 },
      ],
      links: [
        ['S1', 'Gi0/1', 'S2', 'Gi0/1'],
        ['S1', 'Gi0/2', 'S3', 'Gi0/1'],
        ['S2', 'Gi0/2', 'S3', 'Gi0/2'],
        ['PC1', 'Fa0', 'S2', 'Fa0/1'],
        ['PC2', 'Fa0', 'S3', 'Fa0/1'],
      ],
      setup: {
        S1: ['hostname S1'],
        S2: ['hostname S2'],
        S3: ['hostname S3'],
        PC1: ['ipconfig 192.168.1.11 255.255.255.0'],
        PC2: ['ipconfig 192.168.1.12 255.255.255.0'],
      },
      start: 'S1',
      objectives: [
        { text: 'S1 を VLAN 1 のルートブリッジにする', check: (n) => C.stpRoot(n, 'S1', 1) },
        { text: 'S2 を VLAN 1 のセカンダリルート (優先度 28672) にする', check: (n) => NC.bridgePrio(C.dev(n, 'S2'), 1) - 1 === 28672 },
        { text: '全スイッチを Rapid PVST+ (<code>rapid-pvst</code>) に変更', check: (n) => ['S1', 'S2', 'S3'].every((id) => C.dev(n, id).stp.mode === 'rapid-pvst') },
        { text: 'PC 接続ポート (S2・S3 の Fa0/1) を PortFast に', check: (n) => C.ifc(n, 'S2', 'fa0/1').portfast && C.ifc(n, 'S3', 'fa0/1').portfast },
        { text: 'ブロックされるのが S2–S3 間 (S3 側) のポートになる', check: (n) => C.stpAltn(n, 'S3', 'gi0/2', 1) && C.noBlocked(n, 'S1') },
        { text: 'PC1 → PC2 に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.1.12') },
      ],
      hints: [
        'まず各スイッチで <code>show spanning-tree</code>。「This bridge is the root」はどのスイッチ？ ルートは<b>ブリッジ ID (優先度 + MAC) が最小</b>のスイッチです。',
        'S1 で <code>spanning-tree vlan 1 root primary</code> (または <code>spanning-tree vlan 1 priority 4096</code>)',
        'S2 で <code>spanning-tree vlan 1 root secondary</code>。モード変更は <code>spanning-tree mode rapid-pvst</code> (3 台とも)。',
        'PC 接続ポートで <code>interface fa0/1</code> → <code>spanning-tree portfast</code>',
      ],
      solution: {
        S1: ['enable', 'conf t', 'spanning-tree mode rapid-pvst', 'spanning-tree vlan 1 root primary', 'end'],
        S2: ['enable', 'conf t', 'spanning-tree mode rapid-pvst', 'spanning-tree vlan 1 root secondary', 'interface fa0/1', 'spanning-tree portfast', 'end'],
        S3: ['enable', 'conf t', 'spanning-tree mode rapid-pvst', 'interface fa0/1', 'spanning-tree portfast', 'end'],
      },
      learn: ['ルートブリッジ選出 (ブリッジ ID)', 'spanning-tree vlan X root primary / priority', 'ポートの役割 Root / Desg / Altn', 'Rapid PVST+', 'PortFast'],
    },
    // ================================================================ EtherChannel
    {
      id: 'etherchannel',
      title: 'EtherChannel で帯域を束ねる',
      chapter: 'スイッチング',
      difficulty: 3,
      story:
        'S1–S2 間の帯域が足りないので、ケーブルを 2 本に増やしました。ところが <b>STP がループと判断して 1 本をブロック</b>しているため、帯域は増えていません (オレンジの点)。<br>2 本を <b>LACP</b> で束ねて 1 本の論理リンク <b>Port-channel 1</b> にし、両方のリンクを使えるようにしてください。Gi0/1・Gi0/2 はすでにトランクに設定されています。',
      devices: [
        { id: 'S1', type: 'switch', x: 260, y: 170 },
        { id: 'S2', type: 'switch', x: 600, y: 170 },
        { id: 'PC1', type: 'pc', x: 120, y: 330 },
        { id: 'PC2', type: 'pc', x: 740, y: 330 },
      ],
      links: [
        ['S1', 'Gi0/1', 'S2', 'Gi0/1'],
        ['S1', 'Gi0/2', 'S2', 'Gi0/2'],
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S2', 'Fa0/1'],
      ],
      setup: {
        S1: ['hostname S1', 'vlan 10', 'name SALES', 'interface fa0/1', 'switchport mode access', 'switchport access vlan 10', 'interface range g0/1 - 2', 'switchport mode trunk'],
        S2: ['hostname S2', 'vlan 10', 'name SALES', 'interface fa0/1', 'switchport mode access', 'switchport access vlan 10', 'interface range g0/1 - 2', 'switchport mode trunk'],
        PC1: ['ipconfig 192.168.10.11 255.255.255.0'],
        PC2: ['ipconfig 192.168.10.12 255.255.255.0'],
      },
      start: 'S1',
      objectives: [
        { text: 'S1 の Gi0/1・Gi0/2 を channel-group 1 (LACP) に', check: (n) => { const i = NC.channelInfo(C.dev(n, 'S1'), 1); return i.members.length === 2 && i.proto === 'LACP'; } },
        { text: 'S2 の Gi0/1・Gi0/2 を channel-group 1 (LACP) に', check: (n) => { const i = NC.channelInfo(C.dev(n, 'S2'), 1); return i.members.length === 2 && i.proto === 'LACP'; } },
        { text: 'Port-channel 1 が 2 本とも束ねられて up (SU / P)', check: (n) => ['S1', 'S2'].every((id) => NC.channelInfo(C.dev(n, id), 1).bundled.length === 2) },
        { text: 'Port-channel 1 がトランクになっている', check: (n) => ['S1', 'S2'].every((id) => { const po = C.ifc(n, id, 'po1'); return !!po && po.mode === 'trunk'; }) },
        { text: 'STP でブロックされているポートがない', check: (n) => C.noBlocked(n, 'S1') && C.noBlocked(n, 'S2') },
        { text: 'PC1 → PC2 に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.10.12') },
      ],
      hints: [
        '<code>show spanning-tree</code> で、どちらかのスイッチの Gi0/2 が <code>Altn BLK</code> になっていることを確認しましょう。',
        '<code>interface range g0/1 - 2</code> → <code>channel-group 1 mode active</code> (LACP)。もう片側は <code>active</code> か <code>passive</code>。',
        '<code>show etherchannel summary</code> で <code>Po1(SU)</code>・<code>Gi0/1(P)</code> になれば成功。<code>interface port-channel 1</code> の設定は所属ポートにも反映されます。',
      ],
      solution: {
        S1: ['enable', 'conf t', 'interface range g0/1 - 2', 'channel-group 1 mode active', 'interface port-channel 1', 'switchport mode trunk', 'end'],
        S2: ['enable', 'conf t', 'interface range g0/1 - 2', 'channel-group 1 mode passive', 'interface port-channel 1', 'switchport mode trunk', 'end'],
      },
      learn: ['channel-group N mode active / passive (LACP)', 'desirable / auto (PAgP)、on (交渉なし)', 'interface port-channel', 'show etherchannel summary', 'STP からは 1 本の論理リンクに見える'],
    },
    // ================================================================ 7
    {
      id: 'router-on-a-stick',
      title: 'VLAN 間ルーティング (Router on a Stick)',
      chapter: 'スイッチング',
      difficulty: 3,
      story:
        'VLAN 10 (192.168.10.0/24) と VLAN 20 (192.168.20.0/24) の間で通信が必要になりました。R1 の物理インターフェース 1 本に <b>サブインターフェース</b>を作り、802.1Q タグごとにルーティングします。<br>S1 の VLAN とアクセスポートは設定済みです。',
      devices: [
        { id: 'R1', type: 'router', x: 430, y: 70 },
        { id: 'S1', type: 'switch', x: 430, y: 240 },
        { id: 'PC1', type: 'pc', x: 200, y: 350 },
        { id: 'PC2', type: 'pc', x: 660, y: 350 },
      ],
      links: [
        ['R1', 'Gi0/0', 'S1', 'Gi0/1'],
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
      ],
      setup: {
        R1: ['hostname R1'],
        S1: ['hostname S1', 'vlan 10', 'name SALES', 'vlan 20', 'name ENGINEERING', 'interface fa0/1', 'switchport mode access', 'switchport access vlan 10', 'interface fa0/2', 'switchport mode access', 'switchport access vlan 20'],
        PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'],
        PC2: ['ipconfig 192.168.20.10 255.255.255.0 192.168.20.1'],
      },
      start: 'R1',
      objectives: [
        { text: 'S1 の Gi0/1 (R1 向け) をトランクに', check: (n) => C.trunk(n, 'S1', 'gi0/1') },
        { text: 'R1 の G0/0 を有効化', check: (n) => C.up(n, 'R1', 'g0/0') },
        { text: 'G0/0.10: dot1Q 10 / 192.168.10.1/24', check: (n) => { const i = C.ifc(n, 'R1', 'g0/0.10'); return !!i && i.encap === 10 && C.ifIp(n, 'R1', 'g0/0.10', '192.168.10.1', '255.255.255.0'); } },
        { text: 'G0/0.20: dot1Q 20 / 192.168.20.1/24', check: (n) => { const i = C.ifc(n, 'R1', 'g0/0.20'); return !!i && i.encap === 20 && C.ifIp(n, 'R1', 'g0/0.20', '192.168.20.1', '255.255.255.0'); } },
        { text: 'PC1 → PC2 (VLAN 間) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.20.10') },
      ],
      hints: [
        'ルーターは DTP を話さないので、スイッチ側は <code>switchport mode trunk</code> を明示します。',
        '親インターフェース: <code>interface g0/0</code> → <code>no shutdown</code> (IP は設定しない)',
        '<code>interface g0/0.10</code> → <code>encapsulation dot1Q 10</code> → <code>ip address 192.168.10.1 255.255.255.0</code>。encapsulation を先に設定しないと IP を設定できません。',
      ],
      solution: {
        S1: ['enable', 'conf t', 'interface g0/1', 'switchport mode trunk', 'end'],
        R1: [
          'enable', 'conf t', 'interface g0/0', 'no shutdown',
          'interface g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0',
          'interface g0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'end',
        ],
      },
      learn: ['サブインターフェース (g0/0.10)', 'encapsulation dot1Q', 'ルーター向けトランク'],
    },
    // ================================================================ 8
    {
      id: 'static-route',
      title: 'スタティックルートとデフォルトルート',
      chapter: 'ルーティング',
      difficulty: 2,
      story:
        '3 台のルーターが直列につながっています。インターフェースはすべて設定済みで、R2 にはルートが設定されています。<br>R1 と R3 にルートを追加し、端から端まで通信できるようにしてください。R3 は <b>デフォルトルート</b>だけで済ませます。',
      devices: [
        { id: 'PC1', type: 'pc', x: 70, y: 310 },
        { id: 'R1', type: 'router', x: 220, y: 140 },
        { id: 'R2', type: 'router', x: 430, y: 140 },
        { id: 'R3', type: 'router', x: 640, y: 140 },
        { id: 'PC3', type: 'pc', x: 790, y: 310 },
      ],
      links: [
        ['PC1', 'Fa0', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'R2', 'Gi0/0'],
        ['R2', 'Gi0/1', 'R3', 'Gi0/0'],
        ['R3', 'Gi0/1', 'PC3', 'Fa0'],
      ],
      setup: {
        R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shutdown'],
        R2: ['hostname R2', 'interface g0/0', 'ip address 10.0.12.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 10.0.23.1 255.255.255.252', 'no shutdown', 'ip route 192.168.1.0 255.255.255.0 10.0.12.1', 'ip route 192.168.3.0 255.255.255.0 10.0.23.2'],
        R3: ['hostname R3', 'interface g0/0', 'ip address 10.0.23.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 192.168.3.1 255.255.255.0', 'no shutdown'],
        PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'],
        PC3: ['ipconfig 192.168.3.10 255.255.255.0 192.168.3.1'],
      },
      start: 'R1',
      objectives: [
        { text: 'R1 に 192.168.3.0/24 へのスタティックルート (ネクストホップ 10.0.12.2)', check: (n) => C.staticRoute(n, 'R1', '192.168.3.0', '255.255.255.0', '10.0.12.2') },
        { text: 'R3 にデフォルトルート (0.0.0.0/0 → 10.0.23.1)', check: (n) => C.staticRoute(n, 'R3', '0.0.0.0', '0.0.0.0', '10.0.23.1') },
        { text: 'PC1 → PC3 (192.168.3.10) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.3.10') },
        { text: 'PC1 → R3 の G0/0 (10.0.23.2) に ping が通る', check: (n) => C.ping(n, 'PC1', '10.0.23.2') },
      ],
      hints: [
        '書式: <code>ip route &lt;宛先NW&gt; &lt;マスク&gt; &lt;ネクストホップ&gt;</code>。例: <code>ip route 192.168.3.0 255.255.255.0 10.0.12.2</code>',
        'デフォルトルート: <code>ip route 0.0.0.0 0.0.0.0 10.0.23.1</code>',
        '最後の目標は 10.0.23.0/30 宛て。R1 のルーティングテーブル (<code>show ip route</code>) にこのネットワークはありますか？',
      ],
      solution: {
        R1: ['enable', 'conf t', 'ip route 192.168.3.0 255.255.255.0 10.0.12.2', 'ip route 10.0.23.0 255.255.255.252 10.0.12.2', 'end'],
        R3: ['enable', 'conf t', 'ip route 0.0.0.0 0.0.0.0 10.0.23.1', 'end'],
      },
      learn: ['ip route', 'デフォルトルート 0.0.0.0/0', 'show ip route', '往路と復路の両方にルートが必要'],
    },
    // ================================================================ 9
    {
      id: 'ospf',
      title: 'OSPF で動的ルーティング',
      chapter: 'ルーティング',
      difficulty: 3,
      story:
        '3 拠点を三角形に接続しました。ルートを手動で管理するのは大変なので <b>OSPF (エリア 0)</b> を導入します。<br>R1 は設定済みです (<code>show running-config</code> で参考にしましょう)。R2 と R3 を設定してください。<table class="kv"><tr><td>プロセス ID</td><td>1</td></tr><tr><td>Router ID</td><td>R2 = 2.2.2.2 / R3 = 3.3.3.3</td></tr><tr><td>LAN 側 G0/0</td><td>passive-interface</td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 430, y: 40 },
        { id: 'R1', type: 'router', x: 430, y: 150 },
        { id: 'R2', type: 'router', x: 230, y: 310 },
        { id: 'R3', type: 'router', x: 630, y: 310 },
        { id: 'PC2', type: 'pc', x: 70, y: 310 },
        { id: 'PC3', type: 'pc', x: 790, y: 310 },
      ],
      links: [
        ['PC1', 'Fa0', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'R2', 'Gi0/1'],
        ['R1', 'Gi0/2', 'R3', 'Gi0/1'],
        ['R2', 'Gi0/2', 'R3', 'Gi0/2'],
        ['PC2', 'Fa0', 'R2', 'Gi0/0'],
        ['PC3', 'Fa0', 'R3', 'Gi0/0'],
      ],
      setup: {
        R1: [
          'hostname R1', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown',
          'interface g0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shutdown',
          'interface g0/2', 'ip address 10.0.13.1 255.255.255.252', 'no shutdown',
          'router ospf 1', 'router-id 1.1.1.1', 'passive-interface g0/0',
          'network 192.168.1.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.3 area 0', 'network 10.0.13.0 0.0.0.3 area 0',
        ],
        R2: [
          'hostname R2', 'interface g0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown',
          'interface g0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shutdown',
          'interface g0/2', 'ip address 10.0.23.1 255.255.255.252', 'no shutdown',
        ],
        R3: [
          'hostname R3', 'interface g0/0', 'ip address 192.168.3.1 255.255.255.0', 'no shutdown',
          'interface g0/1', 'ip address 10.0.13.2 255.255.255.252', 'no shutdown',
          'interface g0/2', 'ip address 10.0.23.2 255.255.255.252', 'no shutdown',
        ],
        PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'],
        PC2: ['ipconfig 192.168.2.10 255.255.255.0 192.168.2.1'],
        PC3: ['ipconfig 192.168.3.10 255.255.255.0 192.168.3.1'],
      },
      start: 'R2',
      objectives: [
        { text: 'R2 の OSPF Router ID を 2.2.2.2 に', check: (n) => C.rid(n, 'R2', '2.2.2.2') },
        { text: 'R3 の OSPF Router ID を 3.3.3.3 に', check: (n) => C.rid(n, 'R3', '3.3.3.3') },
        { text: 'R2・R3 の G0/0 を passive-interface に', check: (n) => C.passive(n, 'R2', 'g0/0') && C.passive(n, 'R3', 'g0/0') },
        { text: '全ルーターがそれぞれ 2 台の OSPF ネイバーと FULL', check: (n) => ['R1', 'R2', 'R3'].every((r) => C.ospfNbrs(n, r) === 2) },
        { text: 'PC1 → PC2・PC3、PC2 → PC3 に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.2.10') && C.ping(n, 'PC1', '192.168.3.10') && C.ping(n, 'PC2', '192.168.3.10') },
        { text: '冗長性: R1–R3 間リンクが落ちても PC1 → PC3 が通る', check: (n) => C.withShut(n, 'R1', 'g0/2', () => C.ping(n, 'PC1', '192.168.3.10')) },
      ],
      hints: [
        '<code>router ospf 1</code> → <code>router-id 2.2.2.2</code>',
        '<code>network &lt;NW&gt; &lt;ワイルドカード&gt; area 0</code>。/30 のワイルドカードは 0.0.0.3、/24 は 0.0.0.255。R2 なら 192.168.2.0・10.0.12.0・10.0.23.0 の 3 つ。',
        '<code>passive-interface g0/0</code> で LAN 側に Hello を送らないようにします (ネットワーク自体は広報されます)。',
        '<code>show ip ospf neighbor</code> と <code>show ip route</code> (O のルート) で確認しましょう。',
      ],
      solution: {
        R2: ['enable', 'conf t', 'router ospf 1', 'router-id 2.2.2.2', 'network 192.168.2.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0', 'passive-interface g0/0', 'end'],
        R3: ['enable', 'conf t', 'router ospf 1', 'router-id 3.3.3.3', 'network 192.168.3.0 0.0.0.255 area 0', 'network 10.0.13.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0', 'passive-interface g0/0', 'end'],
      },
      learn: ['router ospf / router-id', 'network ... wildcard ... area 0', 'passive-interface', 'show ip ospf neighbor', 'DR / BDR'],
    },
    // ================================================================ IPv6
    {
      id: 'ipv6',
      title: 'IPv6 アドレスとルーティング',
      chapter: 'ルーティング',
      difficulty: 3,
      story:
        '新しい拠点を <b>IPv6</b> で構築します。R2 側は設定済みです。R1 を設定してください。PC1 は手動設定せず、ルーターからの通知 (RA) で自動設定 (<b>SLAAC</b>) させます。<table class="kv"><tr><td>R1 G0/0 (PC1 側)</td><td>2001:DB8:1::1/64</td></tr><tr><td>R1 G0/1 (R2 側)</td><td>2001:DB8:12::1/64</td></tr><tr><td>R2 G0/0</td><td>2001:DB8:12::2/64</td></tr><tr><td>PC2 の LAN</td><td>2001:DB8:2::/64 (PC2 = ::10)</td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 90, y: 210 },
        { id: 'R1', type: 'router', x: 310, y: 210 },
        { id: 'R2', type: 'router', x: 550, y: 210 },
        { id: 'PC2', type: 'pc', x: 770, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'R2', 'Gi0/0'],
        ['R2', 'Gi0/1', 'PC2', 'Fa0'],
      ],
      setup: {
        R1: ['hostname R1'],
        R2: ['hostname R2', 'ipv6 unicast-routing', 'interface g0/0', 'ipv6 address 2001:DB8:12::2/64', 'no shutdown', 'interface g0/1', 'ipv6 address 2001:DB8:2::1/64', 'no shutdown', 'exit', 'ipv6 route ::/0 2001:DB8:12::1'],
        PC2: ['ipv6config 2001:DB8:2::10/64 2001:DB8:2::1'],
      },
      start: 'R1',
      objectives: [
        { text: 'R1 で IPv6 ルーティングを有効化 (<code>ipv6 unicast-routing</code>)', check: (n) => C.dev(n, 'R1').ipv6Routing },
        { text: 'R1 G0/0 に 2001:DB8:1::1/64 を設定し有効化', check: (n) => C.v6(n, 'R1', 'g0/0', '2001:db8:1::1', 64) && C.up(n, 'R1', 'g0/0') },
        { text: 'R1 G0/1 に 2001:DB8:12::1/64 を設定し有効化', check: (n) => C.v6(n, 'R1', 'g0/1', '2001:db8:12::1', 64) && C.up(n, 'R1', 'g0/1') },
        { text: 'R1 に 2001:DB8:2::/64 へのスタティックルート', check: (n) => C.dev(n, 'R1').staticRoutes6.some((r) => r.net === NC.ip6.ip6Parse('2001:db8:2::') && r.plen === 64) },
        { text: 'PC1 が SLAAC で 2001:DB8:1::/64 のアドレスを取得', check: (n) => { const i = C.dev(n, 'PC1').ifaces.FastEthernet0; return !!i.ip6 && !!i.ip6.auto && NC.ip6.in6(i.ip6.addr, NC.ip6.ip6Parse('2001:db8:1::'), 64); } },
        { text: 'PC1 → PC2 (2001:DB8:2::10) に ping が通る', check: (n) => C.ping6(n, 'PC1', '2001:db8:2::10') },
      ],
      hints: [
        'グローバル設定モードで <code>ipv6 unicast-routing</code>。これがないとルーターは IPv6 を転送せず、RA も送りません。',
        '<code>interface g0/0</code> → <code>ipv6 address 2001:DB8:1::1/64</code> → <code>no shutdown</code> (G0/1 も同様)',
        '<code>ipv6 route 2001:DB8:2::/64 2001:DB8:12::2</code>',
        'PC1 で <code>ipv6config autoconfig</code>。ゲートウェイがルーターの <code>FE80::</code> (リンクローカル) になることを確認しましょう。',
      ],
      solution: {
        R1: [
          'enable', 'conf t', 'ipv6 unicast-routing', 'interface g0/0', 'ipv6 address 2001:DB8:1::1/64', 'no shutdown',
          'interface g0/1', 'ipv6 address 2001:DB8:12::1/64', 'no shutdown', 'exit', 'ipv6 route 2001:DB8:2::/64 2001:DB8:12::2', 'end',
        ],
        PC1: ['ipv6config autoconfig'],
      },
      learn: ['IPv6 アドレスの省略表記 (::)', 'ipv6 unicast-routing', 'ipv6 address / ipv6 route', 'SLAAC と EUI-64', 'リンクローカルアドレス FE80::'],
    },
    // ================================================================ 10
    {
      id: 'dhcp',
      title: 'DHCP サーバーの構築',
      chapter: 'IP サービスとセキュリティ',
      difficulty: 2,
      story:
        'PC が増えて手動の IP 設定が追いつきません。R1 を <b>DHCP サーバー</b>にして、PC が自動で IP を取得できるようにしましょう。<br><table class="kv"><tr><td>プール名</td><td><code>LAN50</code></td></tr><tr><td>ネットワーク</td><td>192.168.50.0/24</td></tr><tr><td>除外</td><td>192.168.50.1 〜 192.168.50.10 (機器用)</td></tr><tr><td>DNS</td><td>8.8.8.8</td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 110, y: 100 },
        { id: 'PC2', type: 'pc', x: 110, y: 320 },
        { id: 'S1', type: 'switch', x: 340, y: 210 },
        { id: 'R1', type: 'router', x: 600, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
      ],
      setup: { R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.50.1 255.255.255.0', 'no shutdown'] },
      start: 'R1',
      objectives: [
        { text: '192.168.50.1〜192.168.50.10 を除外アドレスに', check: (n) => C.dev(n, 'R1').dhcp.excluded.some((x) => x.lo <= ip('192.168.50.1') && x.hi >= ip('192.168.50.10')) },
        { text: 'プール LAN50 (network / default-router / dns-server) を作成', check: (n) => { const p = C.dev(n, 'R1').dhcp.pools.LAN50; return !!p && p.network === ip('192.168.50.0') && p.mask === ip('255.255.255.0') && p.router === ip('192.168.50.1') && p.dns === ip('8.8.8.8'); } },
        { text: 'PC1 が DHCP で IP を取得 (.11 以降)', check: (n) => { const d = C.dev(n, 'PC1'); const a = d.ifaces.FastEthernet0.ip; return d.dhcpClient && a >= ip('192.168.50.11') && a <= ip('192.168.50.254'); } },
        { text: 'PC2 が DHCP で IP を取得 (.11 以降)', check: (n) => { const d = C.dev(n, 'PC2'); const a = d.ifaces.FastEthernet0.ip; return d.dhcpClient && a >= ip('192.168.50.11') && a <= ip('192.168.50.254'); } },
        { text: 'PC1 → R1 (192.168.50.1) に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.50.1') },
      ],
      hints: [
        'まず除外: <code>ip dhcp excluded-address 192.168.50.1 192.168.50.10</code>',
        '<code>ip dhcp pool LAN50</code> → <code>network 192.168.50.0 255.255.255.0</code> → <code>default-router 192.168.50.1</code> → <code>dns-server 8.8.8.8</code>',
        'PC をクリックして <code>ipconfig /dhcp</code> を実行。R1 で <code>show ip dhcp binding</code> を見てみましょう。',
      ],
      solution: {
        R1: ['enable', 'conf t', 'ip dhcp excluded-address 192.168.50.1 192.168.50.10', 'ip dhcp pool LAN50', 'network 192.168.50.0 255.255.255.0', 'default-router 192.168.50.1', 'dns-server 8.8.8.8', 'end'],
        PC1: ['ipconfig /dhcp'],
        PC2: ['ipconfig /dhcp'],
      },
      learn: ['ip dhcp excluded-address', 'ip dhcp pool / network / default-router / dns-server', 'show ip dhcp binding', 'ip helper-address (DHCP リレー)'],
    },
    // ================================================================ 11
    {
      id: 'acl',
      title: 'ACL でアクセス制御',
      chapter: 'IP サービスとセキュリティ',
      difficulty: 3,
      story:
        'サーバー LAN (192.168.100.0/24) への通信を制限します。<br>・<b>PC1</b> はサーバーにアクセス可<br>・<b>PC2 (192.168.10.11)</b> はサーバーへのアクセス禁止<br>・<b>ゲスト LAN (192.168.20.0/24)</b> はサーバーへのアクセス禁止<br>ただし、サーバー以外への通信は止めてはいけません。<b>標準 ACL</b> で実装してください。',
      devices: [
        { id: 'PC1', type: 'pc', x: 80, y: 60 },
        { id: 'PC2', type: 'pc', x: 80, y: 220 },
        { id: 'S1', type: 'switch', x: 240, y: 140 },
        { id: 'R1', type: 'router', x: 450, y: 210 },
        { id: 'Guest', type: 'pc', x: 260, y: 350 },
        { id: 'Server', type: 'server', x: 720, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'Server', 'Fa0'],
        ['R1', 'Gi0/2', 'Guest', 'Fa0'],
      ],
      setup: {
        R1: [
          'hostname R1', 'interface g0/0', 'description SALES-LAN', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown',
          'interface g0/1', 'description SERVER-LAN', 'ip address 192.168.100.1 255.255.255.0', 'no shutdown',
          'interface g0/2', 'description GUEST-LAN', 'ip address 192.168.20.1 255.255.255.0', 'no shutdown',
        ],
        PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'],
        PC2: ['ipconfig 192.168.10.11 255.255.255.0 192.168.10.1'],
        Guest: ['ipconfig 192.168.20.10 255.255.255.0 192.168.20.1'],
        Server: ['ipconfig 192.168.100.100 255.255.255.0 192.168.100.1'],
      },
      start: 'R1',
      objectives: [
        { text: '標準 ACL を作成してインターフェースに適用', check: (n) => { const d = C.dev(n, 'R1'); return Object.values(d.ifaces).some((i) => [i.aclIn, i.aclOut].some((a) => a && d.acls[a] && d.acls[a].type === 'standard')); } },
        { text: 'PC1 → Server に ping が通る', check: (n) => C.ping(n, 'PC1', '192.168.100.100') },
        { text: 'PC2 → Server は拒否される', expectFail: true, check: (n) => !C.ping(n, 'PC2', '192.168.100.100') },
        { text: 'Guest → Server は拒否される', expectFail: true, check: (n) => !C.ping(n, 'Guest', '192.168.100.100') },
        { text: 'Guest → PC2 には ping が通る (サーバー以外は許可)', check: (n) => C.ping(n, 'Guest', '192.168.10.11') },
      ],
      hints: [
        '標準 ACL は送信元だけを見るので「宛先の近く」に適用するのがセオリー。今回はサーバー側 G0/1 の <b>out</b> 方向です。',
        '<code>access-list 10 deny host 192.168.10.11</code><br><code>access-list 10 deny 192.168.20.0 0.0.0.255</code>',
        'ACL の最後には暗黙の deny any があります！ <code>access-list 10 permit any</code> を忘れずに。',
        '<code>interface g0/1</code> → <code>ip access-group 10 out</code>。<code>show access-lists</code> でヒット数を確認できます。',
      ],
      solution: {
        R1: ['enable', 'conf t', 'access-list 10 deny host 192.168.10.11', 'access-list 10 deny 192.168.20.0 0.0.0.255', 'access-list 10 permit any', 'interface g0/1', 'ip access-group 10 out', 'end'],
      },
      learn: ['access-list (標準 1-99)', 'ワイルドカードマスク / host / any', '暗黙の deny', 'ip access-group in/out', '名前付き ACL: ip access-list standard NAME'],
    },
    // ================================================================ 12
    {
      id: 'nat',
      title: 'NAT / PAT でインターネット接続',
      chapter: 'IP サービスとセキュリティ',
      difficulty: 3,
      story:
        'いよいよインターネット接続です。ISP からはグローバル IP <b>203.0.113.0/29</b> が割り当てられています (R1 の G0/1 = .2, ISP = .1)。<br>ISP はプライベート IP (192.168.x.x) へのルートを持っていないので、<b>PAT</b> で社内 PC を R1 の G0/1 のアドレスに変換します。<br>さらに社内 Web サーバー <b>SRV (192.168.1.100)</b> を <b>203.0.113.5</b> で公開 (静的 NAT) します。<br><small>ISP ルーターは閲覧のみ可能です。</small>',
      devices: [
        { id: 'PC1', type: 'pc', x: 70, y: 80 },
        { id: 'PC2', type: 'pc', x: 70, y: 220 },
        { id: 'SRV', type: 'server', x: 120, y: 360 },
        { id: 'S1', type: 'switch', x: 240, y: 210 },
        { id: 'R1', type: 'router', x: 430, y: 210 },
        { id: 'ISP', type: 'router', x: 620, y: 210, locked: true },
        { id: 'WEB', type: 'server', x: 790, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['SRV', 'Fa0', 'S1', 'Fa0/3'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'ISP', 'Gi0/0'],
        ['ISP', 'Gi0/1', 'WEB', 'Fa0'],
      ],
      setup: {
        R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 203.0.113.2 255.255.255.248', 'no shutdown'],
        ISP: ['hostname ISP', 'interface g0/0', 'ip address 203.0.113.1 255.255.255.248', 'no shutdown', 'interface g0/1', 'ip address 198.51.100.1 255.255.255.0', 'no shutdown'],
        PC1: ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1'],
        PC2: ['ipconfig 192.168.1.11 255.255.255.0 192.168.1.1'],
        SRV: ['ipconfig 192.168.1.100 255.255.255.0 192.168.1.1'],
        WEB: ['ipconfig 198.51.100.10 255.255.255.0 198.51.100.1'],
      },
      start: 'R1',
      objectives: [
        { text: 'R1 にデフォルトルート (→ 203.0.113.1)', check: (n) => C.staticRoute(n, 'R1', '0.0.0.0', '0.0.0.0', '203.0.113.1') },
        { text: 'G0/0 を ip nat inside、G0/1 を ip nat outside に', check: (n) => C.ifc(n, 'R1', 'g0/0').nat === 'inside' && C.ifc(n, 'R1', 'g0/1').nat === 'outside' },
        { text: 'PC1 → WEB (198.51.100.10) に ping が通る', check: (n) => C.ping(n, 'PC1', '198.51.100.10') },
        { text: 'PC2 → WEB に ping が通る', check: (n) => C.ping(n, 'PC2', '198.51.100.10') },
        { text: '静的 NAT: WEB → 203.0.113.5 (SRV) に ping が通る', check: (n) => C.ping(n, 'WEB', '203.0.113.5') },
      ],
      hints: [
        'まずデフォルトルート: <code>ip route 0.0.0.0 0.0.0.0 203.0.113.1</code>。この段階で PC1 → WEB の ping は? (ISP には戻りのルートがありません)',
        '変換対象を ACL で定義: <code>access-list 1 permit 192.168.1.0 0.0.0.255</code>',
        'PAT: <code>ip nat inside source list 1 interface g0/1 overload</code>',
        '静的 NAT: <code>ip nat inside source static 192.168.1.100 203.0.113.5</code>',
        'インターフェースに <code>ip nat inside</code> (G0/0) / <code>ip nat outside</code> (G0/1)。<code>show ip nat translations</code> で確認。',
      ],
      solution: {
        R1: [
          'enable', 'conf t', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'access-list 1 permit 192.168.1.0 0.0.0.255',
          'ip nat inside source list 1 interface g0/1 overload', 'ip nat inside source static 192.168.1.100 203.0.113.5',
          'interface g0/0', 'ip nat inside', 'interface g0/1', 'ip nat outside', 'end',
        ],
      },
      learn: ['ip nat inside / outside', 'ip nat inside source list ... interface ... overload (PAT)', 'ip nat inside source static', 'show ip nat translations', 'inside local / inside global'],
    },
    // ================================================================ 13
    {
      id: 'troubleshoot',
      title: '総合演習: 障害対応',
      chapter: '総合',
      difficulty: 3,
      story:
        '🚨 緊急！「サーバーにつながらない」と複数のユーザーから連絡がありました。前任者の設定ミスが <b>4 か所</b> あるようです。<br><code>show ip interface brief</code>・<code>show vlan brief</code>・<code>show ip route</code>・<code>ipconfig</code>・<code>ping</code>・<code>tracert</code> を駆使して原因を特定し、修正してください。<br><table class="kv"><tr><td>ユーザー LAN</td><td>192.168.10.0/24 (VLAN 10)</td></tr><tr><td>R1–R2 間</td><td>10.0.0.0/30</td></tr><tr><td>サーバー LAN</td><td>172.16.1.0/24 (GW .1)</td></tr></table>',
      devices: [
        { id: 'PC1', type: 'pc', x: 70, y: 90 },
        { id: 'PC2', type: 'pc', x: 70, y: 330 },
        { id: 'S1', type: 'switch', x: 230, y: 210 },
        { id: 'R1', type: 'router', x: 420, y: 210 },
        { id: 'R2', type: 'router', x: 610, y: 210 },
        { id: 'SRV', type: 'server', x: 790, y: 210 },
      ],
      links: [
        ['PC1', 'Fa0', 'S1', 'Fa0/1'],
        ['PC2', 'Fa0', 'S1', 'Fa0/2'],
        ['S1', 'Gi0/1', 'R1', 'Gi0/0'],
        ['R1', 'Gi0/1', 'R2', 'Gi0/0'],
        ['R2', 'Gi0/1', 'SRV', 'Fa0'],
      ],
      setup: {
        S1: ['hostname S1', 'vlan 10', 'name USERS', 'vlan 20', 'name VOICE', 'interface fa0/1', 'switchport mode access', 'switchport access vlan 10', 'interface fa0/2', 'switchport mode access', 'switchport access vlan 20', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10'],
        R1: ['hostname R1', 'interface g0/0', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.0.1 255.255.255.252', 'shutdown', 'ip route 172.16.1.0 255.255.255.0 10.0.0.2'],
        R2: ['hostname R2', 'interface g0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 172.16.1.1 255.255.255.0', 'no shutdown', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1'],
        PC1: ['ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'],
        PC2: ['ipconfig 192.168.10.11 255.255.255.0 192.168.10.1'],
        SRV: ['ipconfig 172.16.1.100 255.255.255.0 172.16.1.254'],
      },
      start: 'PC1',
      objectives: [
        { text: 'PC2 → PC1 (同じ VLAN 10) に ping が通る', check: (n) => C.ping(n, 'PC2', '192.168.10.10') },
        { text: 'PC1 → R2 (10.0.0.2) に ping が通る', check: (n) => C.ping(n, 'PC1', '10.0.0.2') },
        { text: 'PC1 → SRV (172.16.1.100) に ping が通る', check: (n) => C.ping(n, 'PC1', '172.16.1.100') },
        { text: 'PC2 → SRV に ping が通る', check: (n) => C.ping(n, 'PC2', '172.16.1.100') },
      ],
      hints: [
        '下の層から確認するのが鉄則。まず S1 で <code>show vlan brief</code>。PC2 がつながる Fa0/2 はどの VLAN？',
        'R1 で <code>show ip interface brief</code>。R2 向けのインターフェースの状態は？',
        'R2 で <code>show ip route</code>。戻りのルートの宛先ネットワークは正しい？ 誤ったルートは <code>no ip route ...</code> で削除できます。',
        'SRV で <code>ipconfig</code>。デフォルトゲートウェイは R2 の IP と一致している？',
      ],
      solution: {
        S1: ['enable', 'conf t', 'interface fa0/2', 'switchport access vlan 10', 'end'],
        R1: ['enable', 'conf t', 'interface g0/1', 'no shutdown', 'end'],
        R2: ['enable', 'conf t', 'no ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'ip route 192.168.10.0 255.255.255.0 10.0.0.1', 'end'],
        SRV: ['ipconfig 172.16.1.100 255.255.255.0 172.16.1.1'],
      },
      learn: ['OSI 下位層からの切り分け', 'show ip interface brief / show vlan brief / show ip route', 'tracert で経路の途切れを特定'],
    },
  ];

  /** レベルのネットワークを構築して初期設定を投入 */
  function buildLevel(level) {
    const net = NC.buildNet(level.devices, level.links);
    for (const [id, lines] of Object.entries(level.setup || {})) {
      const d = net.devices[id];
      if (NC.isHost(d)) NC.runScript(net, id, lines);
      else NC.applyLines(net, id, lines, true);
    }
    NC.touch(net);
    return net;
  }

  function evaluate(level, net) {
    return level.objectives.map((o) => {
      try {
        return !!o.check(net);
      } catch (e) {
        return false;
      }
    });
  }

  NC.LEVELS = LEVELS;
  NC.buildLevel = buildLevel;
  NC.evaluate = evaluate;
  NC.checks = C;
})(typeof window !== 'undefined' ? window : globalThis);
