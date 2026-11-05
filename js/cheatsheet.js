/* コマンド早見表 */
(function (G) {
  'use strict';
  G.NC.CHEATSHEET = [
    {
      title: 'モード移動',
      modes: 'R1>  →  R1#  →  R1(config)#  →  R1(config-if)# など',
      rows: [
        ['enable', 'ユーザー EXEC (>) → 特権 EXEC (#)'],
        ['configure terminal', '特権 EXEC → グローバル設定モード'],
        ['exit', '1 つ上のモードへ戻る'],
        ['end  (Ctrl+Z)', '特権 EXEC モードへ一気に戻る'],
        ['do show ...', '設定モードのまま show などを実行'],
        ['?  /  Tab', 'ヘルプ表示 / コマンド補完 (省略形も可: conf t, int g0/0, sh ip int br)'],
      ],
    },
    {
      title: '基本設定・保存',
      rows: [
        ['hostname R1', 'ホスト名'],
        ['interface g0/0', 'インターフェース設定モード'],
        ['ip address 192.168.1.1 255.255.255.0', 'IP アドレス'],
        ['no shutdown', 'インターフェース有効化'],
        ['description TO-SW1', '説明'],
        ['copy running-config startup-config', '設定保存 (write memory でも可)'],
        ['reload', '再起動 (保存していない設定は消える)'],
      ],
    },
    {
      title: '確認コマンド',
      rows: [
        ['show running-config', '現在の設定 ( | include / section で絞り込み可)'],
        ['show ip interface brief', 'IF の IP と状態一覧'],
        ['show ip route', 'ルーティングテーブル'],
        ['show vlan brief', 'VLAN とアクセスポート'],
        ['show interfaces trunk', 'トランクポート'],
        ['show cdp neighbors', '隣接 Cisco 機器'],
        ['show ip ospf neighbor', 'OSPF ネイバー'],
        ['show access-lists', 'ACL とヒット数'],
        ['show ip nat translations', 'NAT 変換テーブル'],
        ['show ip dhcp binding', 'DHCP 払い出し状況'],
        ['ping / traceroute 10.0.0.1', '疎通・経路確認'],
      ],
    },
    {
      title: 'スイッチ (VLAN・トランク)',
      rows: [
        ['vlan 10  →  name SALES', 'VLAN 作成・命名'],
        ['interface range fa0/1 - 4', '複数ポートを一括設定'],
        ['switchport mode access', 'アクセスポート'],
        ['switchport access vlan 10', '所属 VLAN'],
        ['switchport mode trunk', 'トランクポート'],
        ['switchport trunk native vlan 99', 'ネイティブ VLAN'],
        ['switchport trunk allowed vlan 10,20', '許可 VLAN'],
        ['interface vlan 1  →  ip address ...', '管理用 SVI'],
        ['ip default-gateway 192.168.1.1', 'L2 スイッチのデフォルト GW'],
      ],
    },
    {
      title: 'ルーティング',
      rows: [
        ['ip route 10.0.0.0 255.0.0.0 192.168.1.2', 'スタティックルート'],
        ['ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'デフォルトルート'],
        ['interface g0/0.10  →  encapsulation dot1Q 10', 'サブインターフェース (Router on a Stick)'],
        ['router ospf 1', 'OSPF 起動'],
        ['router-id 1.1.1.1', 'ルーター ID'],
        ['network 10.0.0.0 0.0.0.255 area 0', 'OSPF 有効化 (ワイルドカード)'],
        ['passive-interface g0/0', 'Hello を送らない IF'],
        ['default-information originate', 'デフォルトルートを OSPF で配布'],
      ],
    },
    {
      title: 'IP サービス・セキュリティ',
      rows: [
        ['ip dhcp excluded-address 192.168.1.1 192.168.1.10', 'DHCP 除外アドレス'],
        ['ip dhcp pool LAN  →  network / default-router / dns-server', 'DHCP プール'],
        ['ip helper-address 10.0.0.1', 'DHCP リレー'],
        ['access-list 10 permit 192.168.1.0 0.0.0.255', '標準 ACL (1-99)'],
        ['access-list 100 deny icmp any host 10.0.0.1', '拡張 ACL (100-199)'],
        ['ip access-group 10 out', 'ACL を IF に適用'],
        ['ip nat inside / ip nat outside', 'NAT の内側 / 外側 IF'],
        ['ip nat inside source list 1 interface g0/1 overload', 'PAT'],
        ['ip nat inside source static 192.168.1.100 203.0.113.5', '静的 NAT'],
        ['enable secret PASS', '特権パスワード (ハッシュ)'],
        ['line vty 0 4  →  login local / transport input ssh', 'SSH のみ許可'],
        ['crypto key generate rsa', 'RSA 鍵生成 (要 hostname, ip domain-name)'],
      ],
    },
    {
      title: 'PC (コマンドプロンプト)',
      rows: [
        ['ipconfig', 'IP 設定を表示'],
        ['ipconfig 192.168.1.10 255.255.255.0 192.168.1.1', 'IP / マスク / GW を設定'],
        ['ipconfig /dhcp', 'DHCP で取得'],
        ['ping / tracert 192.168.1.1', '疎通・経路確認'],
      ],
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
