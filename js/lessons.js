/* =========================================================================
 * lessons.js — クリア後の解説と確認クイズ
 *   explain: 「なぜそうなるか」の解説 (HTML)
 *   quiz:    [{ q, c: [選択肢], a: 正解の番号, why: 解説 }]
 * ========================================================================= */
(function (G) {
  'use strict';
  G.NC.LESSONS = {
    tutorial: {
      explain:
        'Cisco 機器には主に 3 つのモードがあります。<b>&gt;</b> のユーザー EXEC は簡単な確認だけ、<b>#</b> の特権 EXEC は show・保存・再起動、<b>(config)#</b> の設定モードで設定を変更します。設定コマンドは設定モードでしか使えません。設定モードのまま show を使いたいときは <code>do show ...</code> と入力します。',
      quiz: [
        { q: 'ルーターの設定を変えるとき、入力する順番として正しいのは？', c: ['enable → configure terminal', 'configure terminal → enable', 'show → configure terminal', 'login → setup'], a: 0, why: 'まず enable で特権 EXEC (#) に入り、次に configure terminal で設定モードに入ります。' },
        { q: '設定モードにいるまま show ip interface brief を実行するには？', c: ['do show ip interface brief', 'show ip interface brief', 'exec show ip interface brief', 'run show ip interface brief'], a: 0, why: '設定モードでは exec コマンドの前に do を付けます。' },
      ],
    },
    'first-router': {
      explain:
        'ルーターのインターフェースは初期状態で <b>shutdown</b> (管理上ダウン) です。IP アドレスを設定しても <code>no shutdown</code> しないと通信できません。<br>設定は <b>running-config (RAM)</b> に入るだけなので、<code>copy running-config startup-config</code> で <b>NVRAM</b> に保存しないと再起動で消えてしまいます。',
      quiz: [
        { q: 'show ip interface brief で Status が「administratively down」。原因は？', c: ['インターフェースが shutdown されている', 'ケーブルが抜けている', 'IP アドレスが間違っている', 'ルーティングがない'], a: 0, why: 'administratively down は管理者が shutdown している状態です。ケーブル断などの場合は down/down になります。' },
        { q: '再起動しても設定が残るようにするコマンドは？', c: ['copy running-config startup-config', 'copy startup-config running-config', 'show running-config', 'erase startup-config'], a: 0, why: 'running-config (RAM) の内容を startup-config (NVRAM) にコピーします。write memory でも同じです。' },
      ],
    },
    'pc-gateway': {
      explain:
        'PC は宛先が<b>自分と同じネットワーク</b>なら直接送り、<b>違うネットワーク</b>ならデフォルトゲートウェイ (ルーター) に送ります。ゲートウェイには、PC と同じサブネットにあるルーターのインターフェースの IP を設定します。今回の PC2 はゲートウェイが存在しないアドレスになっていたため、LAN の外へ出られませんでした。',
      quiz: [
        { q: 'PC (192.168.10.11/24) が 192.168.20.10 に通信するとき、パケットを最初に渡す相手は？', c: ['デフォルトゲートウェイ', '192.168.20.10 に直接', 'DNS サーバー', 'スイッチの管理 IP'], a: 0, why: '宛先が別のネットワークなので、まずデフォルトゲートウェイに送ります。' },
        { q: '同じ LAN の PC とは通信できるのに、別のネットワークには届かない。まず疑うのは？', c: ['デフォルトゲートウェイの設定', 'LAN ケーブル', 'スイッチの電源', 'PC のホスト名'], a: 0, why: 'LAN 内が通じているのでケーブルや電源は正常です。外へ出る入口であるゲートウェイを疑います。' },
      ],
    },
    'switch-svi': {
      explain:
        'L2 スイッチのポートには IP アドレスを設定できません。管理用の IP は <b>VLAN インターフェース (SVI)</b> に設定します。また L2 スイッチはルーティングしないので、別のネットワークにいる管理 PC に返事をするには <code>ip default-gateway</code> が必要です。',
      quiz: [
        { q: 'L2 スイッチに管理用 IP アドレスを設定する場所は？', c: ['interface vlan 1', 'interface fa0/1', 'line vty 0 4', 'router ospf 1'], a: 0, why: '管理 IP は SVI (interface vlan) に設定します。' },
        { q: '同じ LAN からはスイッチに ping が通るが、別ネットワークからは通らない。足りない設定は？', c: ['ip default-gateway', 'no shutdown', 'hostname', 'vlan 1'], a: 0, why: '返事を別ネットワークに送るためのゲートウェイがありません。' },
      ],
    },
    security: {
      explain:
        '<code>enable secret</code> はハッシュ化されて保存されるので <code>enable password</code> より安全です (両方あると secret が優先)。<code>service password-encryption</code> は平文パスワードを簡易的に隠すだけで、強度は高くありません。<br>SSH には「Router 以外のホスト名」「ドメイン名」「RSA 鍵」「ローカルユーザー」が必要です。<code>transport input ssh</code> で暗号化されない Telnet を禁止します。',
      quiz: [
        { q: 'enable secret と enable password の両方を設定した場合、使われるのは？', c: ['enable secret', 'enable password', '先に設定した方', '両方の入力が必要'], a: 0, why: 'enable secret が優先されます。' },
        { q: 'crypto key generate rsa を実行する前に必要な設定は？', c: ['Router 以外のホスト名とドメイン名', 'VLAN とトランク', 'enable secret とバナー', 'IP アドレスと OSPF'], a: 0, why: '鍵の名前は「ホスト名.ドメイン名」で作られるため、両方が必要です。' },
      ],
    },
    vlan: {
      explain:
        'VLAN は 1 台のスイッチを論理的に分割し、別々の<b>ブロードキャストドメイン</b>にします。IP アドレスが同じサブネットでも、VLAN が違えば通信できません。VLAN 同士で通信させるにはルーター (L3) が必要です。',
      quiz: [
        { q: '同じスイッチ・同じサブネットだが、VLAN 10 と VLAN 20 に分かれた PC 同士の ping は？', c: ['通らない', '通る', '片方向だけ通る', '再起動すれば通る'], a: 0, why: 'VLAN が違えばフレームは届きません。' },
        { q: 'show vlan brief に表示されないポートは？', c: ['トランクポート', 'アクセスポート', 'shutdown したポート', 'VLAN 1 のポート'], a: 0, why: 'トランクポートは show interfaces trunk で確認します。' },
      ],
    },
    trunk: {
      explain:
        'トランクは 1 本のリンクで複数の VLAN を運び、<b>802.1Q タグ</b>でどの VLAN のフレームかを区別します。<b>ネイティブ VLAN</b> のフレームだけはタグなしで送られるので、両端で一致させる必要があります。未使用の VLAN に変えるのは VLAN ホッピング攻撃への対策です。',
      quiz: [
        { q: '802.1Q トランクでタグが付かずに送られるのは？', c: ['ネイティブ VLAN のフレーム', 'VLAN 1002 のフレーム', '管理 VLAN のフレーム', 'すべてにタグが付く'], a: 0, why: 'ネイティブ VLAN だけはタグなしで送られます。' },
        { q: '片側が switchport mode trunk、もう片側が初期設定 (dynamic auto) のとき、リンクはどうなる？', c: ['DTP でトランクになる', 'アクセスポートのまま', 'エラーで無効になる', '両方 auto になる'], a: 0, why: 'trunk 側が DTP で交渉し、auto 側もトランクになります。両側が auto ならアクセスのままです。' },
      ],
    },
    stp: {
      explain:
        'スイッチをループ状につなぐと、フレームが永遠に回り続けてネットワークが止まります。<b>STP</b> は一部のポートをブロックしてこれを防ぎます。<br><b>ルートブリッジ</b>はブリッジ ID (優先度 + MAC) が最小のスイッチです。優先度を設定しないと MAC アドレスで決まり、古い機器がルートになることがあるので、コアスイッチを明示的にルートにします。<b>PortFast</b> は PC 接続ポートをすぐに転送状態にする設定です。',
      quiz: [
        { q: 'ルートブリッジに選ばれるのはどのスイッチ？', c: ['ブリッジ ID (優先度 + MAC) が最も小さい', 'ポート数が最も多い', 'MAC アドレスが最も大きい', '最初に起動した'], a: 0, why: '優先度が同じなら MAC アドレスの小さい方が選ばれます。' },
        { q: 'PortFast を設定してはいけないポートは？', c: ['他のスイッチにつながるポート', 'PC につながるポート', 'プリンタにつながるポート', 'サーバーにつながるポート'], a: 0, why: 'スイッチ間で使うと一時的なループの原因になります。' },
      ],
    },
    etherchannel: {
      explain:
        'スイッチ間を複数本のケーブルでつないでも、STP がループと判断して 1 本以外をブロックしてしまいます。<b>EtherChannel</b> で束ねると論理的に 1 本 (Port-channel) として扱われ、すべてのリンクの帯域を使えて冗長性も得られます。<br>交渉方式は <b>LACP</b> (active / passive)、<b>PAgP</b> (desirable / auto)、交渉なしの <b>on</b> の 3 種類です。',
      quiz: [
        { q: 'LACP で EtherChannel が成立しない組み合わせは？', c: ['passive と passive', 'active と active', 'active と passive'], a: 0, why: 'passive はどちらも相手を待つだけなので、交渉が始まりません。' },
        { q: 'EtherChannel を組む前、2 本のリンクのうち STP がブロックするのは？', c: ['1 本', '0 本', '2 本', 'スイッチによって違う'], a: 0, why: '2 本あるとループになるので、1 本がブロックされます。' },
      ],
    },
    'router-on-a-stick': {
      explain:
        '1 本の物理リンクを<b>サブインターフェース</b>に分け、それぞれに <code>encapsulation dot1Q</code> で VLAN を割り当てます。スイッチ側はトランクにする必要があります。各サブインターフェースの IP が、その VLAN のデフォルトゲートウェイになります。',
      quiz: [
        { q: 'サブインターフェース g0/0.10 で、IP アドレスより先に必要なコマンドは？', c: ['encapsulation dot1Q 10', 'no shutdown', 'switchport mode trunk', 'vlan 10'], a: 0, why: 'どの VLAN を担当するか決めないと IP を設定できません。' },
        { q: 'ルーターにつながるスイッチのポートの設定は？', c: ['トランクポート', 'VLAN 10 のアクセスポート', 'VLAN 1 のアクセスポート', 'shutdown'], a: 0, why: '複数の VLAN をタグ付きで運ぶため、トランクにします。' },
      ],
    },
    'static-route': {
      explain:
        'ルーターは直接つながっているネットワークしか知りません。それ以外の宛先にはルートが必要です。ping は往復なので、<b>行きだけでなく帰りのルート</b>も必要です。行き先がすべて同じ方向なら、デフォルトルート <code>0.0.0.0/0</code> でまとめられます。',
      quiz: [
        { q: 'ip route 0.0.0.0 0.0.0.0 10.0.23.1 の意味は？', c: ['ほかのどのルートにも当てはまらない宛先は 10.0.23.1 へ送る', '10.0.23.1 宛ての通信を捨てる', 'すべての通信を拒否する', '10.0.23.0/24 へのルート'], a: 0, why: 'デフォルトルート (最後の頼み) です。' },
        { q: '宛先へのルートはあるのに ping が通らない。考えられる原因は？', c: ['帰りのルートがない', 'IP アドレスが多すぎる', 'ホスト名が違う', 'ルートが多すぎる'], a: 0, why: '返事を返すルーター側にも、送信元へのルートが必要です。' },
      ],
    },
    ospf: {
      explain:
        'OSPF のルーターは互いに<b>ネイバー</b>になってリンクの情報を交換し、コストが最小の経路を自動で計算します。<code>network</code> コマンドのワイルドカードで、OSPF を使うインターフェースを選びます。ネイバーになるにはエリアとサブネットが一致している必要があります。リンクが切れても、自動で別の経路に切り替わります。',
      quiz: [
        { q: '/30 のネットワークを指定するワイルドカードマスクは？', c: ['0.0.0.3', '255.255.255.252', '0.0.0.255', '0.0.0.4'], a: 0, why: 'ワイルドカードはサブネットマスクを反転したものです (255 − 252 = 3)。' },
        { q: 'passive-interface を設定したインターフェースはどうなる？', c: ['Hello を送らないが、ネットワークは広報される', 'ネットワークも広報されない', 'shutdown される', 'コストが 0 になる'], a: 0, why: 'PC しかいない LAN 側で、不要な Hello を止めるために使います。' },
      ],
    },
    ipv6: {
      explain:
        'IPv6 アドレスは 128 ビットです。各ブロックの先頭の 0 は省略でき、0 が続くブロックは <code>::</code> で 1 回だけ省略できます。<br>ルーターで IPv6 を転送するには <code>ipv6 unicast-routing</code> が必要です。これを有効にするとルーター通知 (RA) が送られ、PC は <b>SLAAC</b> で「プレフィックス + EUI-64」からアドレスを自動で作ります。PC のゲートウェイにはルーターの<b>リンクローカルアドレス (FE80::)</b> が使われます。',
      quiz: [
        { q: '2001:0DB8:0000:0000:0000:0000:0000:0001 の正しい省略形は？', c: ['2001:DB8::1', '2001:DB8::0::1', '2001::DB8::1', '2001:DB8:0::0:1::'], a: 0, why: ':: は 1 つのアドレスで 1 回しか使えません。' },
        { q: 'PC が SLAAC でアドレスを作るのに必要なルーター側の設定は？', c: ['ipv6 unicast-routing', 'ip dhcp pool', 'ip routing', 'ipv6 enable だけ'], a: 0, why: 'ipv6 unicast-routing を有効にすると、ルーターが RA を送るようになります。' },
      ],
    },
    dhcp: {
      explain:
        'DHCP は <b>DISCOVER → OFFER → REQUEST → ACK</b> (DORA) の 4 つのやり取りで IP アドレスを配ります。ルーターやサーバーなど固定 IP の機器とかぶらないよう、<code>excluded-address</code> で除外しておきます。DHCP サーバーが別のネットワークにある場合は、PC 側のルーターに <code>ip helper-address</code> を設定してブロードキャストを中継します。',
      quiz: [
        { q: 'DHCP のやり取りの正しい順番は？', c: ['DISCOVER → OFFER → REQUEST → ACK', 'REQUEST → OFFER → DISCOVER → ACK', 'OFFER → DISCOVER → ACK → REQUEST', 'DISCOVER → ACK'], a: 0, why: '頭文字を取って DORA と覚えます。' },
        { q: 'DHCP サーバーが別のネットワークにあるとき必要な設定は？', c: ['ip helper-address', 'ip default-gateway', 'ip nat inside', 'ip dhcp snooping'], a: 0, why: 'ルーターはブロードキャストを転送しないので、helper-address で中継します。' },
      ],
    },
    acl: {
      explain:
        'ACL は<b>上から順に</b>照らし合わせ、最初に当てはまった行で許可か拒否が決まります。最後には目に見えない <b>deny any (暗黙の拒否)</b> があるので、<code>permit any</code> を書かないとすべて拒否されます。<br>標準 ACL は送信元しか見ないので<b>宛先の近く</b>に、拡張 ACL は<b>送信元の近く</b>に適用するのが基本です。',
      quiz: [
        { q: 'access-list 10 deny host 192.168.10.11 の 1 行だけを適用すると？', c: ['すべての通信が拒否される', '192.168.10.11 だけが拒否される', 'すべて許可される', 'エラーになる'], a: 0, why: '最後の暗黙の deny any で、ほかの通信もすべて拒否されます。' },
        { q: '192.168.20.0/24 に一致させるワイルドカードマスクは？', c: ['0.0.0.255', '255.255.255.0', '0.0.0.0', '0.0.255.255'], a: 0, why: '/24 のマスク 255.255.255.0 を反転して 0.0.0.255 です。' },
      ],
    },
    nat: {
      explain:
        'プライベート IP (192.168.x.x など) はインターネットでは使えないので、境界のルーターでグローバル IP に変換します。<b>PAT (overload)</b> はポート番号で区別して、多くの PC で 1 つのグローバル IP を共有します。<b>静的 NAT</b> は 1 対 1 で固定して変換するので、外部から社内サーバーにアクセスできます。',
      quiz: [
        { q: '「inside local」アドレスとは？', c: ['社内ホストの変換前 (プライベート) のアドレス', '社内ホストの変換後のアドレス', '外部ホストのアドレス', 'ISP ルーターのアドレス'], a: 0, why: 'inside global が変換後のグローバルアドレスです。' },
        { q: 'PAT を有効にするキーワードは？', c: ['overload', 'static', 'pool', 'extendable'], a: 0, why: 'ip nat inside source list 1 interface g0/1 overload のように使います。' },
      ],
    },
    troubleshoot: {
      explain:
        '障害対応は OSI の<b>下の層から</b>順に確認すると早く見つかります。<br>① インターフェースの状態 (<code>show ip interface brief</code>)<br>② L2・VLAN (<code>show vlan brief</code>、トランク)<br>③ IP アドレスとゲートウェイ (<code>ipconfig</code>)<br>④ ルーティング (<code>show ip route</code>、行きと帰りの両方)<br><code>tracert</code> でどこまで届いているかを見ると、原因の場所を絞り込めます。',
      quiz: [
        { q: 'インターフェースが administratively down のとき、直すコマンドは？', c: ['no shutdown', 'shutdown', 'ip address', 'clear interface'], a: 0, why: '管理者が shutdown しているので、no shutdown で有効にします。' },
        { q: 'tracert で 2 ホップ目から先が * になる。最も怪しいのは？', c: ['2 ホップ目のルーター周辺の経路や設定', 'PC の LAN ケーブル', 'DNS サーバー', 'PC のホスト名'], a: 0, why: '1 ホップ目までは届いているので、その先のルーターを調べます。' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
