/* node tests/run-tests.js
 * 全ミッションについて:
 *  1. 初期状態ではクリアになっていない
 *  2. 解答例を投入すると全目標を達成し、エラー出力がない
 *  3. running-config → 保存 → reload で設定が完全に復元される
 */
'use strict';
const path = require('path');
for (const f of ['netsim.js', 'ios.js', 'levels.js']) require(path.join(__dirname, '..', 'js', f));
const NC = globalThis.NC;

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fails++;
    console.log('  ✗ ' + msg);
  }
};

for (const L of NC.LEVELS) {
  const net = NC.buildLevel(L);
  const before = NC.evaluate(L, net);
  ok(!before.every(Boolean), `[${L.id}] 初期状態で全目標が達成済みになっている`);

  for (const [id, cmds] of Object.entries(L.solution)) {
    const s = NC.newSession(net, id);
    for (const c of cmds) {
      const r = s.exec(c);
      if (/Invalid input|Incomplete command|Ambiguous|Invalid command|% /.test(r.out) && !/Creating vlan|key modulus|Generating/.test(r.out))
        ok(false, `[${L.id}] ${id}: "${c}" => ${r.out.trim()}`);
    }
  }
  const after = NC.evaluate(L, net);
  after.forEach((v, k) => ok(v, `[${L.id}] 目標未達: ${L.objectives[k].text.replace(/<[^>]+>/g, '')}`));

  // reload 往復テスト
  for (const d of Object.values(net.devices)) {
    if (NC.isHost(d)) continue;
    const run1 = NC.genRun(d).join('\n');
    d.startup = NC.genRun(d);
    const nd = NC.rebootDevice(net, d.id);
    const errs = NC.applyLines(net, d.id, nd.startup, false, true);
    errs.forEach((e) => ok(false, `[${L.id}] reload ${d.id}: ${e}`));
    const run2 = NC.genRun(net.devices[d.id]).join('\n');
    ok(run1 === run2, `[${L.id}] reload 後に ${d.id} の設定が一致しない\n--- before\n${run1}\n--- after\n${run2}`);
  }
  const afterReload = NC.evaluate(L, net);
  afterReload.forEach((v, k) => ok(v, `[${L.id}] reload 後に目標未達: ${L.objectives[k].text.replace(/<[^>]+>/g, '')}`));
  console.log((after.every(Boolean) ? '✓ ' : '✗ ') + L.id + ' — ' + L.title);
}

// ---- 個別の挙動テスト
(function cliBehaviour() {
  const net = NC.buildNet(
    [
      { id: 'R1', type: 'router' },
      { id: 'S1', type: 'switch' },
      { id: 'S2', type: 'switch' },
    ],
    [
      ['R1', 'g0/0', 'S1', 'gi0/1'],
      ['S1', 'gi0/2', 'S2', 'gi0/2'],
    ]
  );
  const r = NC.newSession(net, 'R1');
  r.exec('en');
  ok(r.prompt() === 'Router#', 'enable で # プロンプト');
  ok(/Invalid input/.test(r.exec('conf x').out), '不正入力でエラー');
  ok(/Ambiguous/.test(r.exec('co').out), 'あいまいなコマンド');
  r.exec('conf t');
  ok(/Incomplete/.test(r.exec('ip route 10.0.0.0').out), '不完全なコマンド');
  r.exec('int g0/0');
  r.exec('router ospf 1');
  ok(r.prompt() === 'Router(config-router)#', 'サブモードからグローバルコマンドにフォールバック');
  r.exec('int g0/0.10');
  ok(/802.1Q/.test(r.exec('ip address 10.1.1.1 255.255.255.0').out), 'encapsulation 前の IP 設定は拒否');
  r.exec('do show ip int brief');
  ok(r.prompt() === 'Router(config-subif)#', 'do コマンド');
  r.exec('end');
  ok(r.complete('sh') === 'show ', 'Tab 補完');
  ok(/running-config/.test(r.help('show ')), '? ヘルプ');
  // DTP: 片側 trunk, 片側 dynamic auto → trunk
  const s1 = NC.newSession(net, 'S1');
  ['en', 'conf t', 'int gi0/2', 'switchport mode trunk', 'end'].forEach((c) => s1.exec(c));
  ok(NC.opMode(net.devices.S2, net.devices.S2.ifaces['GigabitEthernet0/2']) === 'trunk', 'DTP auto ↔ trunk でトランク成立');
  ok(/Gi0\/2/.test(s1.exec('show interfaces trunk').out), 'show interfaces trunk');
  // enable secret のパスワードプロンプト
  ['conf t', 'enable secret abc', 'end', 'disable', 'enable'].forEach((c) => r.exec(c));
  ok(r.secretInput, 'enable secret 設定後はパスワード入力');
  r.exec('wrong');
  ok(r.prompt() === 'Router>', '誤パスワードで拒否');
  r.exec('enable');
  r.exec('abc');
  ok(r.prompt() === 'Router#', '正しいパスワードで特権モード');
  console.log('✓ CLI 挙動テスト');
})();

if (fails) {
  console.log(`\n${fails} 件の失敗`);
  process.exit(1);
}
console.log('\nすべてのテストに合格しました');
