# NetConfig Quest — CCNA ネットワーク設定ゲーム

Cisco IOS 風の CLI に**実際にコマンドを打ち込んで**ネットワークを組み上げる、CCNA (200-301) 対策のブラウザゲームです。
CCNA 全体ではなく、試験と実務で一番手を動かす **「ネットワーク設定」** に絞っています。

## 遊び方

`index.html` をブラウザで開くだけで動きます (インストール・サーバー不要)。

### ネットに公開する (GitHub Pages)

`.github/workflows/pages.yml` が、push のたびにテストを実行して GitHub Pages に公開します。
**初回だけ**、GitHub のリポジトリ画面で **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** にしてください。
公開後は `https://<ユーザー名>.github.io/<リポジトリ名>/` でスマホからも遊べます。

1. ミッションを選ぶ
2. トポロジ図の機器 (ルーター / スイッチ / PC) をクリックしてターミナルを開く
3. IOS コマンドを入力 — `?` でヘルプ、`Tab` で補完、`conf t` / `sh ip int br` などの省略形も使えます
4. 目標は入力のたびに自動判定。すべて達成でクリア (ヒント・解答例を使うと獲得スターが減ります)

## ミッション一覧

| # | ミッション | 主なコマンド |
|---|---|---|
| T | チュートリアル: CLI の歩き方 | `enable`, `?`, `configure terminal`, `end` |
| 1 | はじめてのルーター設定 | `hostname`, `ip address`, `no shutdown`, `copy run start` |
| 2 | IP アドレスとデフォルトゲートウェイ | PC の `ipconfig`、ゲートウェイ誤りの切り分け |
| 3 | スイッチの管理 IP (SVI) | `interface vlan 1`, `ip default-gateway` |
| 4 | デバイスのセキュリティと SSH | `enable secret`, `line vty`, `crypto key generate rsa`, `transport input ssh` |
| 5 | VLAN でネットワークを分割 | `vlan`, `switchport mode access`, `interface range` |
| 6 | トランクで VLAN を延長 | `switchport mode trunk`, `native vlan` |
| 7 | STP でループを防ぐ | `spanning-tree vlan 1 root primary`, `rapid-pvst`, `portfast` |
| 8 | EtherChannel で帯域を束ねる | `channel-group 1 mode active`, `interface port-channel` |
| 9 | VLAN 間ルーティング (Router on a Stick) | サブインターフェース, `encapsulation dot1Q` |
| 10 | スタティックルートとデフォルトルート | `ip route` |
| 11 | OSPF で動的ルーティング | `router ospf`, `network ... area 0`, `passive-interface` |
| 12 | IPv6 アドレスとルーティング | `ipv6 unicast-routing`, `ipv6 route`, SLAAC |
| 13 | DHCP サーバーの構築 | `ip dhcp pool`, `ip dhcp excluded-address` |
| 14 | ACL でアクセス制御 | `access-list`, `ip access-group` |
| 15 | NAT / PAT でインターネット接続 | `ip nat inside/outside`, `overload`, 静的 NAT |
| 16 | 総合演習: 障害対応 | `show` コマンドで 4 つの設定ミスを特定・修正 |

各ミッションのクリア後に **「なぜそうなるか」の解説** と **確認クイズ** が表示されます。

## トレーニング (何度でも遊べる)

- **🎲 ランダム障害対応** — 17 種類の故障パターンから毎回 2〜3 個をランダムに仕込んだネットワークを直す
- **⏱ タイムアタック** — 3 か所の障害を 10 分以内に直す。ベストタイムを記録
- **🧮 サブネット道場** — ネットワーク / ブロードキャスト / ホスト数 / マスク / ワイルドカードなど 10 問。ブロックサイズ法の解説付き

## シミュレーターでできること

- **IOS CLI**: モード遷移 (`>` `#` `(config)#` `(config-if)#` …)、省略形、`?` ヘルプ、Tab 補完、`do`、`| include` フィルタ、`^` 付きエラー表示
- **show コマンド**: `running-config`, `ip interface brief`, `ip route`, `vlan brief`, `interfaces trunk`, `cdp neighbors`, `ip ospf neighbor`, `access-lists`, `ip nat translations`, `ip dhcp binding` など
- **L2**: VLAN、アクセス / トランク、DTP (dynamic auto / desirable)、ネイティブ VLAN、許可 VLAN、SVI、STP (PVST+ のルートブリッジ選出とポートの役割)、EtherChannel (LACP / PAgP / on)
- **L3**: 直接接続 / スタティック / OSPF (SPF 計算、ECMP、DR/BDR 表示)、ルーター・オン・ア・スティック、IPv6 (スタティック、SLAAC、リンクローカル)
- **サービス**: DHCP (除外・ヘルパー)、標準 / 拡張 / 名前付き ACL、PAT / 静的 NAT、SSH 設定
- **ping / traceroute** はパケットを実際にホップごとに転送して判定 (往路・復路・ACL・NAT を考慮)。トポロジ上にパケットのアニメーションを表示
- `copy run start` / `reload` で保存していない設定が消える挙動も再現

> 学習用シミュレーターのため、タイマー・帯域・STP の収束時間などは簡略化しています。RIP / EIGRP / OSPFv3 / 無線 LAN は未対応です。

## 開発

```
js/netsim.js     ネットワークエンジン (L2/L3 転送, OSPF, ACL, NAT, DHCP)
js/ios.js        IOS CLI インタプリタ / PC コマンドプロンプト
js/levels.js     ミッション定義 (トポロジ・初期設定・目標・ヒント・解答例)
js/lessons.js    クリア後の解説と確認クイズ
js/random.js     ランダム障害対応の問題ジェネレーター (故障パターン集)
js/subnet.js     サブネット道場の問題ジェネレーター
js/app.js        UI (トポロジ描画, ターミナル, 進行管理)
tests/           全ミッション・全故障パターン・reload 往復などの自動テスト
```

```
npm test
```

ミッションの追加は `js/levels.js` にオブジェクトを 1 つ足すだけです。`npm test` が「初期状態では未クリア」「解答例でクリア可能」を自動で検証します。
