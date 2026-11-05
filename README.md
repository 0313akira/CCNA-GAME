# NetConfig Quest — CCNA ネットワーク設定ゲーム

Cisco IOS 風の CLI に**実際にコマンドを打ち込んで**ネットワークを組み上げる、CCNA (200-301) 対策のブラウザゲームです。
CCNA 全体ではなく、試験と実務で一番手を動かす **「ネットワーク設定」** に絞っています。

## 遊び方

`index.html` をブラウザで開くだけで動きます (インストール・サーバー不要)。
GitHub Pages で公開すればスマホからも遊べます。

1. ミッションを選ぶ
2. トポロジ図の機器 (ルーター / スイッチ / PC) をクリックしてターミナルを開く
3. IOS コマンドを入力 — `?` でヘルプ、`Tab` で補完、`conf t` / `sh ip int br` などの省略形も使えます
4. 目標は入力のたびに自動判定。すべて達成でクリア (ヒント・解答例を使うと獲得スターが減ります)

## ミッション一覧

| # | ミッション | 主なコマンド |
|---|---|---|
| 1 | はじめてのルーター設定 | `hostname`, `ip address`, `no shutdown`, `copy run start` |
| 2 | IP アドレスとデフォルトゲートウェイ | PC の `ipconfig`、ゲートウェイ誤りの切り分け |
| 3 | スイッチの管理 IP (SVI) | `interface vlan 1`, `ip default-gateway` |
| 4 | デバイスのセキュリティと SSH | `enable secret`, `line vty`, `crypto key generate rsa`, `transport input ssh` |
| 5 | VLAN でネットワークを分割 | `vlan`, `switchport mode access`, `interface range` |
| 6 | トランクで VLAN を延長 | `switchport mode trunk`, `native vlan` |
| 7 | VLAN 間ルーティング (Router on a Stick) | サブインターフェース, `encapsulation dot1Q` |
| 8 | スタティックルートとデフォルトルート | `ip route` |
| 9 | OSPF で動的ルーティング | `router ospf`, `network ... area 0`, `passive-interface` |
| 10 | DHCP サーバーの構築 | `ip dhcp pool`, `ip dhcp excluded-address` |
| 11 | ACL でアクセス制御 | `access-list`, `ip access-group` |
| 12 | NAT / PAT でインターネット接続 | `ip nat inside/outside`, `overload`, 静的 NAT |
| 13 | 総合演習: 障害対応 | `show` コマンドで 4 つの設定ミスを特定・修正 |

## シミュレーターでできること

- **IOS CLI**: モード遷移 (`>` `#` `(config)#` `(config-if)#` …)、省略形、`?` ヘルプ、Tab 補完、`do`、`| include` フィルタ、`^` 付きエラー表示
- **show コマンド**: `running-config`, `ip interface brief`, `ip route`, `vlan brief`, `interfaces trunk`, `cdp neighbors`, `ip ospf neighbor`, `access-lists`, `ip nat translations`, `ip dhcp binding` など
- **L2**: VLAN、アクセス / トランク、DTP (dynamic auto / desirable)、ネイティブ VLAN、許可 VLAN、SVI
- **L3**: 直接接続 / スタティック / OSPF (SPF 計算、ECMP、DR/BDR 表示)、ルーター・オン・ア・スティック
- **サービス**: DHCP (除外・ヘルパー)、標準 / 拡張 / 名前付き ACL、PAT / 静的 NAT、SSH 設定
- **ping / traceroute** はパケットを実際にホップごとに転送して判定 (往路・復路・ACL・NAT を考慮)。トポロジ上にパケットのアニメーションを表示
- `copy run start` / `reload` で保存していない設定が消える挙動も再現

> 学習用シミュレーターのため、STP・タイマー・帯域などは簡略化しています。

## 開発

```
js/netsim.js     ネットワークエンジン (L2/L3 転送, OSPF, ACL, NAT, DHCP)
js/ios.js        IOS CLI インタプリタ / PC コマンドプロンプト
js/levels.js     ミッション定義 (トポロジ・初期設定・目標・ヒント・解答例)
js/app.js        UI (トポロジ描画, ターミナル, 進行管理)
tests/           全ミッションの解答例・reload 往復などの自動テスト
```

```
npm test
```

ミッションの追加は `js/levels.js` にオブジェクトを 1 つ足すだけです。`npm test` が「初期状態では未クリア」「解答例でクリア可能」を自動で検証します。
