/* =========================================================================
 * ios.js — Cisco IOS 風 CLI インタプリタ (ルーター / スイッチ) と PC コマンドプロンプト
 * ========================================================================= */
(function (G) {
  'use strict';
  const NC = G.NC;
  const { ipToInt, intToIp, prefixToMask, maskToPrefix, netOf, inSubnet, bcastOf, classfulPrefix } = NC.ip;
  const { canonIf, shortIf, cdpIf } = NC.ifname;
  const { ip6Parse, ip6Str, parsePfx6, mask6, linkLocal } = NC.ip6;
  const fmtAny = (a) => (typeof a === 'bigint' ? ip6Str(a) : intToIp(a));
  function copyL2(from, to) {
    to.mode = from.mode;
    to.accessVlan = from.accessVlan;
    to.nativeVlan = from.nativeVlan;
    to.allowed = from.allowed ? new Set(from.allowed) : null;
  }

  // ------------------------------------------------------------ helpers
  const AMBIG = {};
  function matchKw(tok, opts) {
    const t = tok.toLowerCase();
    if (opts.includes(t)) return t;
    const m = opts.filter((o) => o.startsWith(t));
    if (m.length === 1) return m[0];
    if (m.length > 1) return AMBIG;
    return null;
  }
  class CliError extends Error {
    constructor(kind, pos, msg) {
      super(msg || kind);
      this.kind = kind;
      this.pos = pos;
      this.msg = msg;
    }
  }
  function tokenize(line) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) out.push({ t: m[0], pos: m.index });
    return out;
  }

  class Args {
    constructor(line, toks, i) {
      this.line = line;
      this.toks = toks;
      this.i = i || 0;
    }
    get done() {
      return this.i >= this.toks.length;
    }
    cur() {
      if (this.done) throw new CliError('incomplete');
      return this.toks[this.i];
    }
    peek() {
      return this.done ? null : this.toks[this.i].t;
    }
    bad() {
      throw new CliError('invalid', this.done ? this.line.length : this.toks[this.i].pos);
    }
    next() {
      return this.cur() && this.toks[this.i++].t;
    }
    kw(opts) {
      const tok = this.cur();
      const r = matchKw(tok.t, opts);
      if (r === null) throw new CliError('invalid', tok.pos);
      if (r === AMBIG) throw new CliError('ambiguous', tok.pos);
      this.i++;
      return r;
    }
    optKw(opts) {
      if (this.done) return null;
      const r = matchKw(this.toks[this.i].t, opts);
      if (r === null || r === AMBIG) return null;
      this.i++;
      return r;
    }
    ip() {
      const tok = this.cur();
      const v = ipToInt(tok.t);
      if (v === null) throw new CliError('invalid', tok.pos);
      this.i++;
      return v;
    }
    mask() {
      const tok = this.cur();
      const v = ipToInt(tok.t);
      if (v === null || maskToPrefix(v) === null) throw new CliError('invalid', tok.pos);
      this.i++;
      return v;
    }
    num(min, max) {
      const tok = this.cur();
      if (!/^\d+$/.test(tok.t)) throw new CliError('invalid', tok.pos);
      const v = Number(tok.t);
      if (v < min || v > max) throw new CliError('invalid', tok.pos);
      this.i++;
      return v;
    }
    rest() {
      const tok = this.cur();
      this.i = this.toks.length;
      return this.line.slice(tok.pos).trim();
    }
    end() {
      if (!this.done) this.bad();
    }
    /** インターフェース名: "g0/0" / "g 0/0" / "GigabitEthernet 0/0.10" / "vlan 10" */
    ifName() {
      const tok = this.cur();
      let s = tok.t;
      this.i++;
      if (/^[a-zA-Z-]+$/.test(s)) {
        if (this.done) throw new CliError('incomplete');
        s += this.toks[this.i++].t;
      }
      const n = canonIf(s);
      if (!n) throw new CliError('invalid', tok.pos);
      return { name: n, pos: tok.pos };
    }
  }

  function parseVlanList(s) {
    const set = new Set();
    for (const part of s.split(',')) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      const a = Number(m[1]),
        b = m[2] ? Number(m[2]) : a;
      if (a < 1 || b > 4094 || a > b) return null;
      for (let v = a; v <= b; v++) set.add(v);
    }
    return set;
  }
  function fmtVlanList(set) {
    const arr = [...set].sort((a, b) => a - b);
    const out = [];
    for (let k = 0; k < arr.length; k++) {
      let j = k;
      while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++;
      out.push(j > k ? arr[k] + '-' + arr[j] : String(arr[k]));
      k = j;
    }
    return out.join(',');
  }

  // パスワード表示 (type 7 / secret 5 風)
  const XLAT = 'dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87';
  function type7enc(pw) {
    const seed = 8;
    let s = '08';
    for (let i = 0; i < pw.length; i++)
      s += (pw.charCodeAt(i) ^ XLAT.charCodeAt((seed + i) % 53)).toString(16).toUpperCase().padStart(2, '0');
    return s;
  }
  function type7dec(h) {
    const seed = parseInt(h.slice(0, 2), 10);
    let s = '';
    for (let i = 2, j = 0; i + 1 < h.length; i += 2, j++)
      s += String.fromCharCode(parseInt(h.substr(i, 2), 16) ^ XLAT.charCodeAt((seed + j) % 53));
    return s;
  }
  function secretHash(pw) {
    const A = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let h1 = 0x811c9dc5,
      h2 = 5381,
      out = '';
    for (let k = 0; k < 22; k++) {
      for (let i = 0; i < pw.length; i++) {
        h1 = Math.imul(h1 ^ pw.charCodeAt(i), 16777619);
        h2 = (Math.imul(h2, 33) + pw.charCodeAt(i) + k) | 0;
      }
      out += A[((h1 ^ h2) >>> 0) % 64];
      h1 = Math.imul(h1, 2654435761);
    }
    return '$1$mERr$' + out;
  }

  function addrSpecText(sp, std) {
    if (sp.wc === 0xffffffff) return 'any';
    if (sp.wc === 0) return 'host ' + intToIp(sp.base);
    return intToIp(sp.base) + ' ' + intToIp(sp.wc);
  }
  function aceText(acl, e) {
    if (e.remark != null) return 'remark ' + e.remark;
    if (acl.type === 'standard') return e.action + ' ' + addrSpecText(e.src, true);
    return [e.action, e.proto, addrSpecText(e.src), e.srcPort || '', addrSpecText(e.dst), e.dstPort || '', e.extra || '']
      .filter(Boolean)
      .join(' ');
  }

  // ------------------------------------------------------------ running-config
  function genRun(d) {
    const L = [];
    const isR = d.type === 'router';
    const pw = (p) => (d.servicePwEnc ? '7 ' + type7enc(p) : p);
    L.push('!', 'version 15.2', d.servicePwEnc ? 'service password-encryption' : 'no service password-encryption', '!');
    L.push('hostname ' + d.hostname, '!');
    if (d.enableSecret) L.push('enable secret 5 ' + d.enableSecret);
    if (d.enablePassword) L.push('enable password ' + pw(d.enablePassword));
    if (d.enableSecret || d.enablePassword) L.push('!');
    if (isR) {
      for (const x of d.dhcp.excluded) L.push('ip dhcp excluded-address ' + intToIp(x.lo) + (x.hi !== x.lo ? ' ' + intToIp(x.hi) : ''));
      if (d.dhcp.excluded.length) L.push('!');
      for (const p of Object.values(d.dhcp.pools)) {
        L.push('ip dhcp pool ' + p.name);
        if (p.network != null) L.push(' network ' + intToIp(p.network) + ' ' + intToIp(p.mask));
        if (p.router != null) L.push(' default-router ' + intToIp(p.router));
        if (p.dns != null) L.push(' dns-server ' + intToIp(p.dns));
        L.push('!');
      }
    }
    if (d.domainName) L.push('ip domain-name ' + d.domainName);
    for (const u of Object.values(d.users))
      L.push('username ' + u.name + (u.secret ? ' secret 5 ' + u.secret : ' password ' + pw(u.password)));
    if (d.sshVersion) L.push('ip ssh version ' + d.sshVersion);
    if (d.ipv6Routing) L.push('ipv6 unicast-routing');
    L.push('!');
    if (d.type === 'switch') {
      L.push('spanning-tree mode ' + d.stp.mode);
      for (const [v, pr] of [...d.stp.prio.entries()].sort((a, b) => a[0] - b[0])) L.push('spanning-tree vlan ' + v + ' priority ' + pr);
      L.push('!');
    }
    for (const i of NC.sortedIfaces(d)) {
      L.push('interface ' + i.name);
      if (i.desc) L.push(' description ' + i.desc);
      if (i.kind === 'sub' && i.encap != null) L.push(' encapsulation dot1Q ' + i.encap);
      if (d.type === 'switch' && (i.kind === 'phys' || i.kind === 'po')) {
        if (i.accessVlan !== 1) L.push(' switchport access vlan ' + i.accessVlan);
        if (i.nativeVlan !== 1) L.push(' switchport trunk native vlan ' + i.nativeVlan);
        if (i.allowed) L.push(' switchport trunk allowed vlan ' + (i.allowed.size ? fmtVlanList(i.allowed) : 'none'));
        if (i.mode) L.push(' switchport mode ' + i.mode);
        if (i.channel) L.push(' channel-group ' + i.channel.group + ' mode ' + i.channel.mode);
        if (i.portfast) L.push(' spanning-tree portfast');
        if (i.bpduguard) L.push(' spanning-tree bpduguard enable');
      } else {
        L.push(i.ip != null ? ' ip address ' + intToIp(i.ip) + ' ' + intToIp(i.mask) : ' no ip address');
        if (i.helper != null) L.push(' ip helper-address ' + intToIp(i.helper));
        if (i.aclIn) L.push(' ip access-group ' + i.aclIn + ' in');
        if (i.aclOut) L.push(' ip access-group ' + i.aclOut + ' out');
        if (i.nat) L.push(' ip nat ' + i.nat);
        if (i.ospfCost) L.push(' ip ospf cost ' + i.ospfCost);
        if (i.ip6) L.push(' ipv6 address ' + ip6Str(i.ip6.addr) + '/' + i.ip6.plen);
        if (isR && i.kind === 'phys') L.push(' duplex auto', ' speed auto');
      }
      if (i.shutdown) L.push(' shutdown');
      L.push('!');
    }
    if (d.defaultGateway != null) L.push('ip default-gateway ' + intToIp(d.defaultGateway), '!');
    if (d.ospf) {
      const o = d.ospf;
      L.push('router ospf ' + o.pid);
      if (o.routerId != null) L.push(' router-id ' + intToIp(o.routerId));
      if (o.passiveDefault) {
        L.push(' passive-interface default');
        for (const n of [...o.noPassive].sort(NC.ifname.cmpIf)) L.push(' no passive-interface ' + n);
      } else for (const n of [...o.passive].sort(NC.ifname.cmpIf)) L.push(' passive-interface ' + n);
      for (const n of o.networks) L.push(' network ' + intToIp(n.net) + ' ' + intToIp(n.wc) + ' area ' + n.area);
      if (o.defaultOriginate) L.push(' default-information originate' + (o.defaultOriginate === 'always' ? ' always' : ''));
      L.push('!');
    }
    if (isR) {
      for (const p of Object.values(d.nat.pools))
        L.push('ip nat pool ' + p.name + ' ' + intToIp(p.start) + ' ' + intToIp(p.end) + ' netmask ' + intToIp(p.mask));
      for (const r of d.nat.rules) {
        if (r.type === 'static') L.push('ip nat inside source static ' + intToIp(r.local) + ' ' + intToIp(r.global));
        else
          L.push(
            'ip nat inside source list ' + r.acl + (r.iface ? ' interface ' + r.iface : ' pool ' + r.pool) + (r.overload ? ' overload' : '')
          );
      }
      for (const r of d.staticRoutes) {
        L.push(
          'ip route ' + intToIp(r.net) + ' ' + intToIp(r.mask) + (r.iface ? ' ' + r.iface : '') + (r.nh != null ? ' ' + intToIp(r.nh) : '') + (r.ad !== 1 ? ' ' + r.ad : '')
        );
      }
      for (const r of d.staticRoutes6)
        L.push('ipv6 route ' + ip6Str(r.net) + '/' + r.plen + (r.iface ? ' ' + r.iface : '') + (r.nh != null ? ' ' + ip6Str(r.nh) : '') + (r.ad !== 1 ? ' ' + r.ad : ''));
      L.push('!');
    }
    const acls = Object.values(d.acls);
    for (const a of acls.filter((x) => !x.named)) for (const e of a.entries) L.push('access-list ' + a.name + ' ' + aceText(a, e));
    for (const a of acls.filter((x) => x.named)) {
      L.push('ip access-list ' + a.type + ' ' + a.name);
      for (const e of a.entries) L.push(' ' + aceText(a, e));
    }
    if (acls.length) L.push('!');
    if (d.banner != null) L.push('banner motd ^C' + d.banner + '^C', '!');
    const line = (name, l) => {
      L.push(name);
      if (l.password) L.push(' password ' + pw(l.password));
      if (l.login) L.push(l.login === 'local' ? ' login local' : ' login');
      if (l.transport) L.push(' transport input ' + l.transport);
    };
    line('line con 0', d.lines.con);
    line('line vty 0 4', d.lines.vty);
    L.push('!', 'end');
    return L;
  }
  function runningText(d) {
    const body = genRun(d);
    const bytes = body.join('\n').length;
    return ['Building configuration...', '', 'Current configuration : ' + bytes + ' bytes'].concat(body);
  }

  // ------------------------------------------------------------ show helpers
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);

  function showIpIntBrief(d) {
    const out = ['Interface              IP-Address      OK? Method Status                Protocol'];
    for (const i of NC.sortedIfaces(d)) {
      const [st, pr] = NC.ifStatus(d, i);
      const ip = i.ip != null ? intToIp(i.ip) : 'unassigned';
      out.push(pad(i.name, 23) + pad(ip, 16) + 'YES ' + pad(i.ip != null ? 'manual' : 'unset', 7) + pad(st, 22) + pr);
    }
    return out;
  }

  function showIpRoute(net, d) {
    const out = [
      'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
      '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
      '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
      '       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP',
      '       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area',
      '       * - candidate default, U - per-user static route, o - ODR',
      '       P - periodic downloaded static route',
      '',
    ];
    if (d.type !== 'router') {
      out.push(d.defaultGateway != null ? 'Default gateway is ' + intToIp(d.defaultGateway) : 'Default gateway is not set');
      return out;
    }
    const rt = NC.routingTable(net, d);
    const def = rt.find((e) => e.net === 0 && e.mask === 0);
    if (def) {
      const v = def.via[0];
      out.push('Gateway of last resort is ' + (v.ip != null ? intToIp(v.ip) : '0.0.0.0') + ' to network 0.0.0.0', '');
    } else out.push('Gateway of last resort is not set', '');
    const entryLines = (e, indent) => {
      const head = pad(e.code, indent) + intToIp(e.net) + '/' + e.prefix;
      const res = [];
      e.via.forEach((v, k) => {
        let txt;
        if (e.code === 'C' || e.code === 'L') txt = ' is directly connected, ' + v.iface.name;
        else if (v.ip == null) txt = ' is directly connected, ' + v.iface.name;
        else {
          const tm = e.code[0] === 'O' ? ', 00:0' + (1 + (e.metric % 8)) + ':1' + (e.metric % 10) : '';
          txt = ' [' + e.ad + '/' + e.metric + '] via ' + intToIp(v.ip) + tm + (e.code[0] === 'O' && v.iface ? ', ' + v.iface.name : v.iface ? ', ' + v.iface.name : '');
        }
        res.push(k === 0 ? head + txt : ' '.repeat(head.length) + txt);
      });
      return res;
    };
    // クラスフルネットワークごとにまとめる
    const groups = new Map();
    for (const e of rt) {
      if (e.mask === 0) {
        out.push(...entryLines(e, 6));
        continue;
      }
      const cp = classfulPrefix(e.net);
      const key = netOf(e.net, prefixToMask(cp)) + '/' + cp;
      if (!groups.has(key)) groups.set(key, { net: netOf(e.net, prefixToMask(cp)), cp, list: [] });
      groups.get(key).list.push(e);
    }
    for (const g of groups.values()) {
      if (g.list.length === 1 && g.list[0].prefix === g.cp) {
        out.push(...entryLines(g.list[0], 6));
        continue;
      }
      const masks = new Set(g.list.map((e) => e.prefix));
      if (masks.size > 1) out.push('      ' + intToIp(g.net) + '/' + g.cp + ' is variably subnetted, ' + g.list.length + ' subnets, ' + masks.size + ' masks');
      else out.push('      ' + intToIp(g.net) + '/' + [...masks][0] + ' is subnetted, ' + g.list.length + ' subnets');
      for (const e of g.list) out.push(...entryLines(e, 9));
    }
    return out;
  }

  function showVlanBrief(d) {
    const out = [
      'VLAN Name                             Status    Ports',
      '---- -------------------------------- --------- -------------------------------',
    ];
    for (const [v, name] of [...d.vlans.entries()].sort((a, b) => a[0] - b[0])) {
      const ports = NC.logicalPorts(d)
        .filter((lp) => NC.opMode(d, lp.rep) === 'access' && lp.rep.accessVlan === v)
        .map((lp) => shortIf(lp.name));
      const rows = [];
      for (let k = 0; k < ports.length; k += 4) rows.push(ports.slice(k, k + 4).join(', '));
      out.push(pad(v, 5) + pad(name, 33) + pad('active', 10) + (rows[0] || ''));
      for (const r of rows.slice(1)) out.push(' '.repeat(48) + r);
    }
    return out;
  }

  function showTrunk(d) {
    const trunks = NC.logicalPorts(d)
      .filter((lp) => NC.linkUp(d, lp.rep) && NC.opMode(d, lp.rep) === 'trunk')
      .map((lp) => Object.assign({}, lp.rep, { name: lp.name }));
    if (!trunks.length) return [];
    const out = ['Port        Mode             Encapsulation  Status        Native vlan'];
    for (const p of trunks) {
      const mode = p.mode === 'trunk' ? 'on' : p.mode === 'dynamic desirable' ? 'desirable' : 'auto';
      out.push(pad(shortIf(p.name), 12) + pad(mode, 17) + pad('802.1q', 15) + pad('trunking', 14) + p.nativeVlan);
    }
    out.push('', 'Port        Vlans allowed on trunk');
    for (const p of trunks) out.push(pad(shortIf(p.name), 12) + (p.allowed ? fmtVlanList(p.allowed) || 'none' : '1-4094'));
    out.push('', 'Port        Vlans allowed and active in management domain');
    for (const p of trunks) {
      const act = [...d.vlans.keys()].filter((v) => NC.trunkAllows(p, v));
      out.push(pad(shortIf(p.name), 12) + (fmtVlanList(new Set(act)) || 'none'));
    }
    out.push('', 'Port        Vlans in spanning tree forwarding state and not pruned');
    for (const p of trunks) {
      const act = [...d.vlans.keys()].filter((v) => NC.trunkAllows(p, v));
      out.push(pad(shortIf(p.name), 12) + (fmtVlanList(new Set(act)) || 'none'));
    }
    return out;
  }

  function showIntStatus(d) {
    const out = ['Port      Name               Status       Vlan       Duplex  Speed Type'];
    for (const p of NC.physPorts(d)) {
      const st = p.shutdown ? 'disabled' : NC.linkUp(d, p) ? 'connected' : 'notconnect';
      const vl = NC.opMode(d, p) === 'trunk' ? 'trunk' : String(p.accessVlan);
      const gig = p.name.startsWith('Gig');
      out.push(pad(shortIf(p.name), 10) + pad(p.desc.slice(0, 18), 19) + pad(st, 13) + pad(vl, 11) + pad('auto', 8) + pad('auto', 6) + (gig ? '10/100/1000BaseTX' : '10/100BaseTX'));
    }
    return out;
  }

  function showInterfaces(net, d, only) {
    const out = [];
    for (const i of NC.sortedIfaces(d)) {
      if (only && i.name !== only) continue;
      const [st, pr] = NC.ifStatus(d, i);
      out.push(i.name + ' is ' + st + ', line protocol is ' + pr);
      const hw = i.kind === 'loop' ? 'Loopback' : i.kind === 'svi' ? 'EtherSVI' : i.name.startsWith('Gig') ? 'CN Gigabit Ethernet' : 'Lance';
      out.push('  Hardware is ' + hw + ', address is ' + NC.macOf(d, i) + ' (bia ' + NC.macOf(d, i) + ')');
      if (i.desc) out.push('  Description: ' + i.desc);
      if (i.ip != null) out.push('  Internet address is ' + intToIp(i.ip) + '/' + maskToPrefix(i.mask));
      if (i.kind === 'sub' && i.encap != null) out.push('  Encapsulation 802.1Q Virtual LAN, Vlan ID  ' + i.encap);
      else out.push('  MTU 1500 bytes, BW ' + (i.name.startsWith('Gig') ? '1000000' : '100000') + ' Kbit/sec, DLY 10 usec,');
    }
    if (only && !out.length) return null;
    return out;
  }

  function showCdp(d) {
    const out = [
      'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge',
      '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone',
      '',
      'Device ID        Local Intrfce   Holdtme    Capability   Platform    Port ID',
    ];
    for (const p of NC.physPorts(d)) {
      if (!NC.linkUp(d, p)) continue;
      const nd = p.peer.dev;
      if (nd.type !== 'router' && nd.type !== 'switch') continue;
      const cap = nd.type === 'router' ? 'R' : 'S';
      const plat = nd.type === 'router' ? 'C2900' : '2960';
      out.push(pad(nd.hostname, 17) + pad(cdpIf(p.name), 16) + pad('1' + (40 + (p.name.length * 7) % 60), 11) + pad(cap, 13) + pad(plat, 12) + cdpIf(p.peer.iface.name));
    }
    return out;
  }

  function showOspfNbr(net, d) {
    const info = NC.computeOspf(net)[d.id];
    const out = ['', 'Neighbor ID     Pri   State           Dead Time   Address         Interface'];
    if (!info) return out;
    for (const n of info.nbrs) {
      out.push(pad(intToIp(n.rid), 16) + lpad('1', 3) + '   ' + pad(n.state + ',', 16).replace(',', ' ') + pad('00:00:3' + (n.rid % 10), 12) + pad(intToIp(n.addr), 16) + n.local.name);
    }
    return out;
  }

  function showOspf(net, d) {
    if (!d.ospf) return [];
    const rid = NC.routerId(d);
    const info = NC.computeOspf(net)[d.id];
    const out = [' Routing Process "ospf ' + d.ospf.pid + '" with ID ' + (rid != null ? intToIp(rid) : '0.0.0.0')];
    const areas = new Map();
    for (const oi of info ? info.oifs : []) {
      if (!areas.has(oi.area)) areas.set(oi.area, []);
      areas.get(oi.area).push(oi);
    }
    out.push(' Number of areas in this router is ' + areas.size + '. ' + areas.size + ' normal 0 stub 0 nssa');
    for (const [a, l] of areas) {
      out.push('    Area ' + (a === 0 ? 'BACKBONE(0)' : a));
      out.push('        Number of interfaces in this area is ' + l.length + ' (' + l.filter((x) => x.loop).length + ' loopback)');
      for (const oi of l) out.push('        ' + oi.iface.name + (oi.passive ? ' (passive)' : '') + '  cost ' + oi.cost);
    }
    return out;
  }

  function showAcls(d) {
    const out = [];
    for (const a of Object.values(d.acls)) {
      out.push((a.type === 'standard' ? 'Standard' : 'Extended') + ' IP access list ' + a.name);
      for (const e of a.entries) {
        if (e.remark != null) continue;
        let t = aceText(a, e);
        if (a.type === 'standard') t = t.replace(' host ', ' ');
        out.push('    ' + e.seq + ' ' + t + (e.hits ? ' (' + e.hits + ' match(es))' : ''));
      }
    }
    return out;
  }

  function showNat(d) {
    const out = ['Pro  Inside global         Inside local          Outside local         Outside global'];
    for (const t of d.natTable) {
      const port = ':' + t.id;
      out.push(pad('icmp', 5) + pad(intToIp(t.global) + port, 22) + pad(intToIp(t.local) + port, 22) + pad(intToIp(t.outside) + port, 22) + intToIp(t.outside) + port);
    }
    for (const r of d.nat.rules)
      if (r.type === 'static') out.push(pad('---', 5) + pad(intToIp(r.global), 22) + pad(intToIp(r.local), 22) + pad('---', 22) + '---');
    return out;
  }

  function showDhcpBinding(net, d) {
    const out = [
      'Bindings from all pools not associated with VRF:',
      'IP address          Client-ID/              Lease expiration        Type',
      '                    Hardware address',
    ];
    for (const [pc, b] of Object.entries(d.dhcp.bindings)) {
      const dev = net.devices[pc];
      const mac = dev ? NC.macOf(dev, dev.ifaces.FastEthernet0) : '--';
      out.push(pad(intToIp(b.ip), 20) + pad(mac, 24) + pad('--', 24) + 'Automatic');
    }
    return out;
  }


  function showStp(net, d, onlyV) {
    const out = [];
    const vlans = [...d.vlans.keys()].sort((a, b) => a - b).filter((v) => !onlyV || v === onlyV);
    for (const v of vlans) {
      const I = NC.computeStp(net, v)[d.id];
      if (!I || !I.ports.length) continue;
      const root = I.best.root;
      out.push('VLAN' + String(v).padStart(4, '0'), '  Spanning tree enabled protocol ' + (d.stp.mode === 'rapid-pvst' ? 'rstp' : 'ieee'));
      out.push('  Root ID    Priority    ' + root[0], '             Address     ' + root[1]);
      if (!I.rootPort) out.push('             This bridge is the root');
      else out.push('             Cost        ' + I.best.cost, '             Port        ' + I.rootPort.pid + ' (' + I.rootPort.name + ')');
      out.push('             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '');
      out.push('  Bridge ID  Priority    ' + I.bid[0] + '  (priority ' + (I.bid[0] - v) + ' sys-id-ext ' + v + ')', '             Address     ' + I.bid[1]);
      out.push('             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '             Aging Time  300 sec', '');
      out.push('Interface           Role Sts Cost      Prio.Nbr Type', '------------------- ---- --- --------- -------- --------------------------------');
      for (const pt of I.ports.slice().sort((a, b) => NC.ifname.cmpIf(a.name, b.name)))
        out.push(pad(shortIf(pt.name), 20) + pad(pt.role, 5) + pad(pt.role === 'Altn' ? 'BLK' : 'FWD', 4) + pad(pt.cost, 10) + pad('128.' + pt.pid, 9) + 'P2p' + (pt.edge ? ' Edge' : ''));
      out.push('');
    }
    if (!out.length) out.push('No spanning tree instance exists.');
    return out;
  }
  function showEtherchannel(d) {
    const groups = [...new Set(NC.physPorts(d).filter((p) => p.channel).map((p) => p.channel.group))].sort((a, b) => a - b);
    const out = [
      'Flags:  D - down        P - bundled in port-channel',
      '        I - stand-alone s - suspended',
      '        H - Hot-standby (LACP only)',
      '        R - Layer3      S - Layer2',
      '        U - in use      f - failed to allocate aggregator',
      '',
      'Number of channel-groups in use: ' + groups.length,
      'Number of aggregators:           ' + groups.length,
      '',
      'Group  Port-channel  Protocol    Ports',
      '------+-------------+-----------+-----------------------------------------------',
    ];
    for (const g of groups) {
      const info = NC.channelInfo(d, g);
      out.push(pad(g, 7) + pad('Po' + g + '(' + (info.bundled.length ? 'SU' : 'SD') + ')', 14) + pad(info.proto, 12) + info.members.map((m) => shortIf(m.name) + '(' + info.st.get(m) + ')').join(' '));
    }
    return out;
  }
  function showIpv6Brief(d) {
    const out = [];
    for (const i of NC.sortedIfaces(d)) {
      if (i.kind === 'po') continue;
      const [st, pr] = NC.ifStatus(d, i);
      out.push(pad(i.name, 23) + '[' + st + '/' + pr + ']');
      if (NC.hasV6(d, i)) {
        out.push('    ' + ip6Str(linkLocal(d, i)));
        if (i.ip6) out.push('    ' + ip6Str(i.ip6.addr));
      } else out.push('    unassigned');
    }
    return out;
  }
  function showIpv6Route(net, d) {
    const rt = NC.routingTable6(net, d);
    const out = [
      'IPv6 Routing Table - default - ' + rt.length + ' entries',
      'Codes: C - Connected, L - Local, S - Static, U - Per-user Static route',
      '       B - BGP, R - RIP, I1 - ISIS L1, I2 - ISIS L2',
      '       IA - ISIS interarea, IS - ISIS summary, D - EIGRP, EX - EIGRP external',
      '       ND - ND Default, NDp - ND Prefix, O - OSPF Intra, OI - OSPF Inter',
      '       OE1 - OSPF ext 1, OE2 - OSPF ext 2, ON1 - OSPF NSSA ext 1, ON2 - OSPF NSSA ext 2',
    ];
    for (const e of rt) {
      const v = e.via[0];
      out.push(pad(e.code, 4) + ip6Str(e.net) + '/' + e.plen + ' [' + e.ad + '/0]');
      if (e.code === 'C') out.push('     via ' + v.iface.name + ', directly connected');
      else if (e.code === 'L') out.push('     via ' + v.iface.name + ', receive');
      else out.push('     via ' + (v.ip != null ? ip6Str(v.ip) : '') + (v.iface ? (v.ip != null ? ', ' : '') + v.iface.name : ''));
    }
    return out;
  }

  // ------------------------------------------------------------ help trees
  // h: help text, s: subtree, a: argument hints
  const ADDR = 'A.B.C.D';
  const H = {
    exec: {
      enable: { h: 'Turn on privileged commands' },
      disable: { h: 'Turn off privileged commands', p: 1 },
      configure: { h: 'Enter configuration mode', p: 1, s: { terminal: { h: 'Configure from the terminal' } } },
      show: {
        h: 'Show running system information',
        s: {
          'running-config': { h: 'Current operating configuration' },
          'startup-config': { h: 'Contents of startup configuration' },
          ip: {
            h: 'IP information',
            s: {
              interface: { h: 'IP interface status and configuration', s: { brief: { h: 'Brief summary of IP status and configuration' } } },
              route: { h: 'IP routing table' },
              ospf: { h: 'OSPF information', s: { neighbor: { h: 'Neighbor list' }, interface: { h: 'Interface information' } } },
              nat: { h: 'IP NAT information', s: { translations: { h: 'Translation entries' } } },
              dhcp: { h: 'Show items in the DHCP database', s: { binding: { h: 'DHCP address bindings' }, pool: { h: 'DHCP pools information' } } },
              ssh: { h: 'Information on SSH' },
            },
          },
          interfaces: { h: 'Interface status and configuration', s: { trunk: { h: 'Show interface trunk information' }, status: { h: 'Show interface line status' } } },
          vlan: { h: 'VTP VLAN status', s: { brief: { h: 'VTP all VLAN status in brief' } } },
          'access-lists': { h: 'List access lists' },
          cdp: { h: 'CDP information', s: { neighbors: { h: 'CDP neighbor entries' } } },
          ipv6: { h: 'IPv6 information', s: { interface: { h: 'IPv6 interface status and configuration', s: { brief: { h: 'Brief summary of IPv6 status and configuration' } } }, route: { h: 'Show IPv6 route table entries' } } },
          'spanning-tree': { h: 'Spanning tree topology', s: { vlan: { h: 'VLAN Switch Spanning Trees', a: ['<1-4094>  Spanning tree VLAN id'] } } },
          etherchannel: { h: 'EtherChannel information', s: { summary: { h: 'One-line summary per channel-group' } } },
          version: { h: 'System hardware and software status' },
          history: { h: 'Display the session command history' },
        },
      },
      ping: { h: 'Send echo messages', a: ['WORD  Ping destination address or hostname'] },
      traceroute: { h: 'Trace route to destination', a: ['WORD  Trace route to destination address or hostname'] },
      copy: { h: 'Copy from one file to another', p: 1, s: { 'running-config': { h: 'Copy from current system configuration', s: { 'startup-config': { h: 'Copy to startup configuration' } } } } },
      write: { h: 'Write running configuration to memory', p: 1, s: { memory: { h: 'Write to NV memory' } } },
      reload: { h: 'Halt and perform a cold restart', p: 1 },
      erase: { h: 'Erase a filesystem', p: 1, s: { 'startup-config': { h: 'Erase contents of configuration memory' } } },
      clear: { h: 'Reset functions', p: 1, s: { ip: { h: 'IP', s: { nat: { h: 'Clear NAT', s: { translation: { h: 'Clear dynamic translation' } } } } } } },
      terminal: { h: 'Set terminal line parameters', s: { length: { h: 'Set number of lines on a screen' } } },
      exit: { h: 'Exit from the EXEC' },
      logout: { h: 'Exit from the EXEC' },
    },
    config: {
      hostname: { h: 'Set system\'s network name', a: ['WORD  This system\'s network name'] },
      interface: { h: 'Select an interface to configure', s: { range: { h: 'interface range command' }, 'Port-channel': { h: 'Ethernet Channel of interfaces' }, GigabitEthernet: { h: 'GigabitEthernet IEEE 802.3z' }, FastEthernet: { h: 'FastEthernet IEEE 802.3' }, Loopback: { h: 'Loopback interface' }, Vlan: { h: 'Catalyst Vlans' } } },
      vlan: { h: 'Vlan commands', a: ['<1-4094>  ISL VLAN IDs 1-1005'] },
      router: { h: 'Enable a routing process', s: { ospf: { h: 'Open Shortest Path First (OSPF)', a: ['<1-65535>  Process ID'] } } },
      ip: {
        h: 'Global IP configuration subcommands',
        s: {
          route: { h: 'Establish static routes', a: [ADDR + '  Destination prefix', ADDR + '  Destination prefix mask', ADDR + '  Forwarding router\'s address'] },
          'default-gateway': { h: 'Specify default gateway (if not routing IP)', a: [ADDR + '  IP address of default gateway'] },
          'domain-name': { h: 'Define the default domain name', a: ['WORD  Default domain name'] },
          dhcp: { h: 'Configure DHCP server and relay parameters', s: { pool: { h: 'Configure DHCP address pools', a: ['WORD  Pool name'] }, 'excluded-address': { h: 'Prevent DHCP from assigning certain addresses', a: [ADDR + '  Low IP address', ADDR + '  High IP address'] } } },
          nat: { h: 'NAT configuration commands', s: { inside: { h: 'Inside address translation', s: { source: { h: 'Source address translation', s: { list: { h: 'Specify access list describing local addresses' }, static: { h: 'Specify static local->global mapping' } } } } }, pool: { h: 'Define pool of addresses' } } },
          'access-list': { h: 'Named access-list', s: { standard: { h: 'Standard Access List' }, extended: { h: 'Extended Access List' } } },
          ssh: { h: 'Configure ssh options', s: { version: { h: 'Specify protocol version supported', a: ['<1-2>  Protocol version'] } } },
          routing: { h: 'Enable IP routing' },
        },
      },
      ipv6: { h: 'Global IPv6 configuration commands', s: { 'unicast-routing': { h: 'Enable unicast routing' }, route: { h: 'Configure static routes', a: ['X:X:X:X::X/<0-128>  IPv6 prefix', 'X:X:X:X::X  IPv6 address of next-hop'] } } },
      'access-list': { h: 'Add an access list entry', a: ['<1-99>  IP standard access list\n  <100-199>  IP extended access list'] },
      enable: { h: 'Modify enable password parameters', s: { secret: { h: 'Assign the privileged level secret', a: ['WORD  The UNENCRYPTED (cleartext) \'enable\' secret'] }, password: { h: 'Assign the privileged level password' } } },
      line: { h: 'Configure a terminal line', s: { console: { h: 'Primary terminal line', a: ['<0-0>  First Line number'] }, vty: { h: 'Virtual terminal', a: ['<0-15>  First Line number', '<1-15>  Last Line number'] } } },
      service: { h: 'Modify use of network based services', s: { 'password-encryption': { h: 'Encrypt system passwords' } } },
      banner: { h: 'Define a login banner', s: { motd: { h: 'Set Message of the Day banner', a: ['LINE  c banner-text c, where \'c\' is a delimiting character'] } } },
      username: { h: 'Establish User Name Authentication', a: ['WORD  User name', 'secret  Specify the secret for the user'] },
      crypto: { h: 'Encryption module', s: { key: { h: 'Long term key operations', s: { generate: { h: 'Generate new keys', s: { rsa: { h: 'Generate RSA keys' } } } } } } },
      'spanning-tree': { h: 'Spanning Tree Subsystem', s: { mode: { h: 'Spanning tree operating mode', s: { pvst: { h: 'Per-Vlan spanning tree mode' }, 'rapid-pvst': { h: 'Per-Vlan rapid spanning tree mode' } } }, vlan: { h: 'VLAN Switch Spanning Tree', a: ['WORD  vlan range, example: 1,3-5,7,9-11', 'priority  Set the bridge priority for the spanning tree\n  root      Configure switch as root'] } } },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Exit from configure mode' },
    },
    if: {
      ip: {
        h: 'Interface Internet Protocol config commands',
        s: {
          address: { h: 'Set the IP address of an interface', a: [ADDR + '  IP address', ADDR + '  IP subnet mask'] },
          'access-group': { h: 'Specify access control for packets', a: ['<1-199>  IP access list (standard or extended)\n  WORD       Access-list name', 'in   inbound packets\n  out  outbound packets'] },
          nat: { h: 'NAT interface commands', s: { inside: { h: 'Inside interface for address translation' }, outside: { h: 'Outside interface for address translation' } } },
          ospf: { h: 'OSPF interface commands', s: { cost: { h: 'Interface cost', a: ['<1-65535>  Cost'] } } },
          'helper-address': { h: 'Specify a destination address for UDP broadcasts', a: [ADDR + '  IP destination address'] },
        },
      },
      shutdown: { h: 'Shutdown the selected interface' },
      description: { h: 'Interface specific description', a: ['LINE  Up to 240 characters describing this interface'] },
      switchport: {
        h: 'Set switching mode characteristics',
        s: {
          mode: { h: 'Set trunking mode of the interface', s: { access: { h: 'Set trunking mode to ACCESS unconditionally' }, trunk: { h: 'Set trunking mode to TRUNK unconditionally' }, dynamic: { h: 'Set trunking mode to dynamically negotiate access or trunk mode', s: { auto: { h: 'Set trunking mode dynamic negotiation parameter to AUTO' }, desirable: { h: 'Set trunking mode dynamic negotiation parameter to DESIRABLE' } } } } },
          access: { h: 'Set access mode characteristics of the interface', s: { vlan: { h: 'Set VLAN when interface is in access mode', a: ['<1-4094>  VLAN ID of the VLAN when this port is in access mode'] } } },
          trunk: { h: 'Set trunking characteristics of the interface', s: { native: { h: 'Set trunking native characteristics when interface is in trunking mode', s: { vlan: { h: 'Set native VLAN when interface is in trunking mode' } } }, allowed: { h: 'Set allowed VLAN characteristics when interface is in trunking mode', s: { vlan: { h: 'Set allowed VLANs when interface is in trunking mode', a: ['WORD  VLAN IDs of the allowed VLANs (e.g. 10,20,30-40)'] } } }, encapsulation: { h: 'Set trunking encapsulation when interface is in trunking mode' } } },
          nonegotiate: { h: 'Device will not engage in negotiation protocol on this interface' },
        },
      },
      ipv6: { h: 'IPv6 interface subcommands', s: { address: { h: 'Configure IPv6 address on interface', a: ['X:X:X:X::X/<0-128>  IPv6 prefix'] }, enable: { h: 'Enable IPv6 on interface' } } },
      'channel-group': { h: 'Etherchannel/port bundling configuration', a: ['<1-6>  Channel group number', 'mode  Etherchannel Mode of the interface'] },
      encapsulation: { h: 'Set encapsulation type for an interface', s: { dot1Q: { h: 'IEEE 802.1Q Virtual LAN', a: ['<1-4094>  IEEE 802.1Q VLAN ID'] } } },
      duplex: { h: 'Configure duplex operation.' },
      speed: { h: 'Configure speed operation.' },
      'spanning-tree': { h: 'Spanning Tree Subsystem', s: { portfast: { h: 'Spanning tree portfast options' }, bpduguard: { h: 'Don\'t accept BPDUs on this interface', s: { enable: { h: 'Enable BPDU guard for this interface' } } } } },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Exit from interface configuration mode' },
    },
    router: {
      network: { h: 'Enable routing on an IP network', a: [ADDR + '  Network number', ADDR + '  OSPF wild card bits', 'area  Set the OSPF area ID'] },
      'router-id': { h: 'router-id for this OSPF process', a: [ADDR + '  OSPF router-id in IP address format'] },
      'passive-interface': { h: 'Suppress routing updates on an interface' },
      'default-information': { h: 'Control distribution of default information', s: { originate: { h: 'Distribute a default route' } } },
      'auto-cost': { h: 'Calculate OSPF interface cost according to bandwidth' },
      'log-adjacency-changes': { h: 'Log changes in adjacency state' },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Exit from routing protocol configuration mode' },
    },
    vlan: {
      name: { h: 'Ascii name of the VLAN', a: ['WORD  The ascii name for the VLAN'] },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Apply changes, bump revision number, and exit mode' },
    },
    line: {
      password: { h: 'Set a password', a: ['WORD  The UNENCRYPTED (cleartext) line password'] },
      login: { h: 'Enable password checking', s: { local: { h: 'Local password checking' } } },
      transport: { h: 'Define transport protocols for line', s: { input: { h: 'Define which protocols to use when connecting to the terminal server', s: { ssh: { h: 'TCP/IP SSH protocol' }, telnet: { h: 'TCP/IP Telnet protocol' }, all: { h: 'All protocols' }, none: { h: 'No protocols' } } } } },
      'exec-timeout': { h: 'Set the EXEC timeout' },
      logging: { h: 'Modify message logging facilities', s: { synchronous: { h: 'Synchronized message output' } } },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Exit from line configuration mode' },
    },
    dhcp: {
      network: { h: 'Network number and mask', a: [ADDR + '  Network number in dotted-decimal notation', ADDR + '  Network mask'] },
      'default-router': { h: 'Default routers', a: [ADDR + '  Router\'s IP address'] },
      'dns-server': { h: 'DNS servers', a: [ADDR + '  Server\'s IP address'] },
      'domain-name': { h: 'Domain name' },
      lease: { h: 'Address lease time' },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Exit from DHCP pool configuration mode' },
    },
    acl: {
      permit: { h: 'Specify packets to forward' },
      deny: { h: 'Specify packets to reject' },
      remark: { h: 'Access list entry comment' },
      no: { h: 'Negate a command or set its defaults' },
      do: { h: 'To run exec commands in config mode' },
      end: { h: 'Exit from configure mode' },
      exit: { h: 'Exit from access-list configuration mode' },
    },
  };
  const MODE_HELP = { config: 'config', if: 'if', router: 'router', vlan: 'vlan', line: 'line', dhcp: 'dhcp', acl: 'acl' };

  // ------------------------------------------------------------ 初心者向けヒント
  const CFG_WORDS = /^(hostname|int|interface|ip|ipv6|router|vlan|no|access-list|line|enable|service|banner|username|crypto|spanning-tree|switchport|shut|shutdown|description|network|encapsulation|channel-group)$/i;
  const EXEC_WORDS = /^(sh|sho|show|ping|traceroute|copy|write|wr|reload|clear)$/i;
  function maskLike(wc) {
    return (wc >>> 0) >= 0x80000000 && maskToPrefix(wc) !== null && wc !== 0xffffffff;
  }
  /** エラー時 (または成功時) に、初心者がつまずきやすいポイントを日本語で補足する */
  function beginnerTip(mode, line, kind) {
    const t = line.trim();
    const first = (t.split(/\s+/)[0] || '').toLowerCase();
    if (/\d+\.\d+\.\d+\.\d+\/\d{1,2}\b/.test(t)) return 'IOS ではマスクを /24 のようには書けません。ドット表記で書きます (例: /24 → 255.255.255.0、/30 → 255.255.255.252)';
    if (mode === 'user' && (/^conf/i.test(first) || CFG_WORDS.test(first))) return '設定を変えるには、まず enable で特権 EXEC モード (#) に入り、configure terminal で設定モードに入ります';
    if (mode === 'priv' && CFG_WORDS.test(first)) return '設定コマンドは configure terminal (conf t) で設定モード (config)# に入ってから入力します';
    if (mode !== 'user' && mode !== 'priv' && EXEC_WORDS.test(first)) return '設定モードで show や ping を使うときは、先頭に do を付けます (例: do show ip interface brief)';
    if (kind === 'ambiguous') return '省略しすぎて候補が複数あります。もう少し長く入力するか、? で候補を確認しましょう';
    if (kind === 'incomplete') return '続きの入力が必要です。最後に「スペース + ?」を入力すると、次に入れるものが表示されます';
    if (kind === 'invalid') return '^ の位置のつづりや値を確認しましょう。? で、そこに入力できるものが表示されます';
    return null;
  }

  // ------------------------------------------------------------ IOS session
  class IosSession {
    constructor(net, devId) {
      this.net = net;
      this.devId = devId;
      this.mode = 'user';
      this.ctx = {};
      this.pending = null;
      this.history = [];
    }
    get dev() {
      return this.net.devices[this.devId];
    }
    get secretInput() {
      return !!(this.pending && this.pending.secret);
    }
    prompt() {
      if (this.pending) return this.pending.prompt;
      const h = this.dev.hostname;
      switch (this.mode) {
        case 'user':
          return h + '>';
        case 'priv':
          return h + '#';
        case 'config':
          return h + '(config)#';
        case 'if':
          return h + (this.ctx.ifs.length > 1 ? '(config-if-range)#' : this.ctx.ifs[0].kind === 'sub' ? '(config-subif)#' : '(config-if)#');
        case 'router':
          return h + '(config-router)#';
        case 'vlan':
          return h + '(config-vlan)#';
        case 'line':
          return h + '(config-line)#';
        case 'dhcp':
          return h + '(dhcp-config)#';
        case 'acl':
          return h + (this.ctx.acl.type === 'standard' ? '(config-std-nacl)#' : '(config-ext-nacl)#');
      }
      return h + '#';
    }
    helpTree() {
      if (this.mode === 'user' || this.mode === 'priv') {
        const t = {};
        for (const [k, v] of Object.entries(H.exec)) if (this.mode === 'priv' || !v.p) t[k] = v;
        return t;
      }
      return H[MODE_HELP[this.mode]];
    }

    /** 1 行実行 */
    exec(rawLine) {
      const res = { out: [], events: [] };
      const promptLen = this.prompt().length;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        p.fn.call(this, rawLine.trim(), res);
        this.track(false);
        NC.touch(this.net);
        return { out: res.out.join('\n'), events: res.events };
      }
      let line = rawLine.replace(/\s+$/, '');
      if (!line.trim()) return { out: '', events: [] };
      if (/\?$/.test(line)) return { out: this.help(line.replace(/\?$/, '').replace(/^\s+/, '')), events: [] };
      this.history.push(line.trim());
      const wasCfg = this.mode !== 'user' && this.mode !== 'priv';
      let filter = null;
      const pi = line.indexOf(' | ');
      if (pi > 0) {
        const fm = line.slice(pi + 3).trim().match(/^(\S+)\s+(.*)$/);
        line = line.slice(0, pi);
        if (fm) {
          const k = matchKw(fm[1], ['include', 'begin', 'exclude', 'section']);
          if (k && k !== AMBIG) filter = { k, re: new RegExp(fm[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
        }
      }
      const modeBefore = this.mode;
      try {
        this.dispatch(line, res);
        // 成功しても意図と違いそうな入力 (ワイルドカードの代わりにサブネットマスク)
        const m = line.trim().match(/^(?:no\s+)?(network|access-list\s+\d+\s+(?:permit|deny))\s+\d+\.\d+\.\d+\.\d+\s+(\d+\.\d+\.\d+\.\d+)/i);
        if (m && maskLike(ipToInt(m[2])))
          res.tip = m[2] + ' はサブネットマスクの形です。ここにはワイルドカードマスク (マスクを反転したもの) を書きます (例: 255.255.255.0 → 0.0.0.255)';
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        res.tip = beginnerTip(modeBefore, line, e.kind);
        res.out.length = 0;
        if (e.kind === 'invalid') res.out.push(' '.repeat(promptLen + (e.pos || 0)) + '^', "% Invalid input detected at '^' marker.", '');
        else if (e.kind === 'ambiguous') res.out.push('% Ambiguous command:  "' + line.trim() + '"');
        else if (e.kind === 'incomplete') res.out.push('% Incomplete command.', '');
        else res.out.push(e.msg);
      }
      if (filter) {
        let lines = res.out.join('\n').split('\n');
        if (filter.k === 'include') lines = lines.filter((l) => filter.re.test(l));
        else if (filter.k === 'exclude') lines = lines.filter((l) => !filter.re.test(l));
        else if (filter.k === 'begin') {
          const idx = lines.findIndex((l) => filter.re.test(l));
          lines = idx < 0 ? [] : lines.slice(idx);
        } else if (filter.k === 'section') {
          const out = [];
          let on = false;
          for (const l of lines) {
            if (!/^\s/.test(l)) on = filter.re.test(l);
            if (on) out.push(l);
          }
          lines = out;
        }
        res.out = lines;
      }
      this.track(wasCfg);
      NC.touch(this.net);
      return { out: res.out.join('\n'), events: res.events, tip: res.tip || null };
    }

    dispatch(line, res) {
      const toks = tokenize(line);
      if (this.mode === 'user' || this.mode === 'priv') return this.runExec(new Args(line, toks, 0), res);
      if (toks[0].t.toLowerCase() === 'do') {
        if (toks.length < 2) throw new CliError('incomplete');
        return this.runExec(new Args(line, toks, 1), res, true);
      }
      if (this.mode === 'config') return this.runTable(this.mode, new Args(line, toks, 0), res);
      try {
        return this.runTable(this.mode, new Args(line, toks, 0), res);
      } catch (e) {
        if (!(e instanceof CliError) || e.kind !== 'invalid') throw e;
        // サブモードで解釈できなければグローバル設定モードとして解釈 (実機と同じ挙動)
        const saveMode = this.mode,
          saveCtx = this.ctx;
        this.mode = 'config';
        this.ctx = {};
        try {
          return this.runTable('config', new Args(line, toks, 0), res);
        } catch (e2) {
          this.mode = saveMode;
          this.ctx = saveCtx;
          throw e;
        }
      }
    }

    runTable(mode, a, res) {
      const table = CMD[mode];
      const keys = Object.keys(table);
      let neg = false;
      const tok = a.cur();
      let k = matchKw(tok.t, keys.concat(['no']));
      if (k === AMBIG) throw new CliError('ambiguous', tok.pos);
      if (k === null) throw new CliError('invalid', tok.pos);
      a.i++;
      if (k === 'no') {
        neg = true;
        const t2 = a.cur();
        k = matchKw(t2.t, keys);
        if (k === AMBIG) throw new CliError('ambiguous', t2.pos);
        if (k === null) throw new CliError('invalid', t2.pos);
        a.i++;
      }
      return table[k].call(this, a, neg, res);
    }

    runExec(a, res, fromConfig) {
      const priv = this.mode !== 'user' || fromConfig;
      const keys = Object.keys(EXEC).filter((k) => priv || !H.exec[k] || !H.exec[k].p);
      const tok = a.cur();
      const k = matchKw(tok.t, keys);
      if (k === AMBIG) throw new CliError('ambiguous', tok.pos);
      if (k === null) throw new CliError('invalid', tok.pos);
      a.i++;
      return EXEC[k].call(this, a, res, fromConfig);
    }

    track(wasCfg) {
      const S = this.net.seen;
      if (!S) return;
      S.add(this.devId + ':mode:' + this.mode);
      if (wasCfg && this.mode === 'priv') S.add(this.devId + ':back');
    }
    // ---------------- context help ('?')
    help(line) {
      if (this.net.seen) this.net.seen.add(this.devId + ':help');
      const tree = this.helpTree();
      const toks = tokenize(line);
      const trailing = line === '' || /\s$/.test(line);
      let node = { s: tree },
        idx = 0;
      const out = [];
      const list = (s, prefix) => {
        const ks = Object.keys(s).filter((k) => k.toLowerCase().startsWith((prefix || '').toLowerCase()));
        const w = Math.max(...ks.map((k) => k.length), 8) + 2;
        for (const k of ks.sort()) out.push('  ' + pad(k, w) + (s[k].h || ''));
      };
      let walk = toks.slice();
      if (walk.length && walk[0].t.toLowerCase() === 'do' && this.mode !== 'user' && this.mode !== 'priv') {
        node = { s: H.exec };
        walk = walk.slice(1);
      }
      if (walk.length && walk[0].t.toLowerCase() === 'no' && node.s.no) walk = walk.slice(1);
      const upto = trailing ? walk.length : walk.length - 1;
      let argIdx = 0;
      for (idx = 0; idx < upto; idx++) {
        if (node.s) {
          const k = matchKw(walk[idx].t, Object.keys(node.s).map((x) => x.toLowerCase()));
          const real = k && k !== AMBIG ? Object.keys(node.s).find((x) => x.toLowerCase() === k) : null;
          if (real) {
            node = node.s[real];
            argIdx = 0;
            continue;
          }
          if (!node.a) return '% Unrecognized command';
        }
        argIdx++;
      }
      if (trailing) {
        if (node.s) list(node.s, '');
        if (node.a && node.a[argIdx]) out.push('  ' + node.a[argIdx]);
        if (!node.s && (!node.a || argIdx >= node.a.length)) out.push('  <cr>');
        if (node.s && node === node && !out.length) out.push('  <cr>');
      } else {
        const last = walk[walk.length - 1];
        if (node.s) {
          const ks = Object.keys(node.s).filter((k) => k.toLowerCase().startsWith(last.t.toLowerCase()));
          out.push(ks.sort().join('  ') || '% Unrecognized command');
        } else out.push('% Unrecognized command');
      }
      return out.join('\n');
    }

    // ---------------- Tab 補完
    complete(line) {
      const toks = tokenize(line);
      if (!toks.length || /\s$/.test(line)) return line;
      let node = { s: this.helpTree() };
      let walk = toks;
      if (walk[0].t.toLowerCase() === 'do' && this.mode !== 'user' && this.mode !== 'priv') {
        node = { s: H.exec };
        walk = walk.slice(1);
      }
      if (walk.length > 1 && walk[0].t.toLowerCase() === 'no') walk = walk.slice(1);
      for (let k = 0; k < walk.length - 1; k++) {
        if (!node.s) return line;
        const m = matchKw(walk[k].t, Object.keys(node.s).map((x) => x.toLowerCase()));
        if (!m || m === AMBIG) return line;
        node = node.s[Object.keys(node.s).find((x) => x.toLowerCase() === m)];
      }
      if (!node || !node.s) return line;
      const last = toks[toks.length - 1];
      const ks = Object.keys(node.s).filter((k) => k.toLowerCase().startsWith(last.t.toLowerCase()));
      if (ks.length !== 1) return line;
      return line.slice(0, last.pos) + ks[0] + ' ';
    }

    // ---------------- 共通ユーティリティ
    needRouter(a, pos) {
      if (this.dev.type !== 'router') throw new CliError('invalid', pos);
    }
    needSwitch(a, pos) {
      if (this.dev.type !== 'switch') throw new CliError('invalid', pos);
    }
    eachIf(fn) {
      const seen = new Set();
      for (const i of this.ctx.ifs) {
        const list = [i];
        if (i.kind === 'po') list.push(...NC.physPorts(this.dev).filter((p) => p.channel && p.channel.group === Number(i.name.slice(12))));
        for (const x of list)
          if (!seen.has(x)) {
            seen.add(x);
            fn(x);
          }
      }
    }
    getAcl(name, type, named) {
      const d = this.dev;
      if (!d.acls[name]) d.acls[name] = { name, type, named: !!named, entries: [] };
      return d.acls[name];
    }
  }

  // 番号付き ACL の種類
  function aclTypeOf(n) {
    if ((n >= 1 && n <= 99) || (n >= 1300 && n <= 1999)) return 'standard';
    if ((n >= 100 && n <= 199) || (n >= 2000 && n <= 2699)) return 'extended';
    return null;
  }

  function parseAddrSpec(a, std) {
    const k = a.optKw(['any', 'host']);
    if (k === 'any') return { base: 0, wc: 0xffffffff };
    if (k === 'host') return { base: a.ip(), wc: 0 };
    const base = a.ip();
    if (std && (a.done || ipToInt(a.peek()) === null)) return { base, wc: 0 };
    const wc = a.ip();
    return { base: (base & ~wc) >>> 0, wc };
  }
  const PORT_OPS = ['eq', 'gt', 'lt', 'neq', 'range'];
  function parsePortSpec(a) {
    const op = a.optKw(PORT_OPS);
    if (!op) return '';
    const p1 = a.next();
    if (op === 'range') return 'range ' + p1 + ' ' + a.next();
    return op + ' ' + p1;
  }
  /** permit|deny 以降の ACE を解析 */
  function parseAce(a, type, action) {
    const e = { action, hits: 0 };
    if (type === 'standard') {
      e.src = parseAddrSpec(a, true);
      a.optKw(['log']);
      a.end();
      return e;
    }
    e.proto = a.kw(['ip', 'icmp', 'tcp', 'udp']);
    e.src = parseAddrSpec(a, false);
    if (e.proto === 'tcp' || e.proto === 'udp') e.srcPort = parsePortSpec(a);
    e.dst = parseAddrSpec(a, false);
    if (e.proto === 'tcp' || e.proto === 'udp') e.dstPort = parsePortSpec(a);
    const extra = [];
    while (!a.done) extra.push(a.kw(['established', 'log', 'echo', 'echo-reply', 'unreachable']));
    e.extra = extra.join(' ');
    return e;
  }

  // ------------------------------------------------------------ EXEC commands
  const EXEC = {
    enable(a, res) {
      if (this.mode !== 'user') return;
      const d = this.dev;
      if (d.enableSecret || d.enablePassword) {
        this.pending = {
          prompt: 'Password: ',
          secret: true,
          fn(pw, r) {
            const ok = d.enableSecret ? secretHash(pw) === d.enableSecret : pw === d.enablePassword;
            if (ok) this.mode = 'priv';
            else r.out.push('% Access denied', '');
          },
        };
        return;
      }
      this.mode = 'priv';
    },
    disable() {
      this.mode = 'user';
    },
    exit() {
      if (this.mode === 'priv' || this.mode === 'user') {
        this.mode = 'user';
      }
    },
    logout() {
      this.mode = 'user';
    },
    configure(a, res, fromConfig) {
      if (fromConfig) a.bad();
      if (!a.done) a.kw(['terminal']);
      if (this.dev.locked) {
        res.out.push('% このデバイスはプロバイダ(ISP)の管理下にあるため設定変更できません。show / ping のみ利用できます。');
        return;
      }
      this.mode = 'config';
      this.ctx = {};
      res.out.push('Enter configuration commands, one per line.  End with CNTL/Z.');
    },
    terminal(a) {
      a.kw(['length', 'monitor']);
      while (!a.done) a.next();
    },
    show(a, res) {
      const net = this.net,
        d = this.dev;
      const k = a.kw(['running-config', 'startup-config', 'ip', 'ipv6', 'interfaces', 'vlan', 'access-lists', 'cdp', 'version', 'history', 'clock', 'arp', 'spanning-tree', 'etherchannel']);
      const out = res.out;
      if (this.net.seen) this.net.seen.add(this.devId + ':show');
      switch (k) {
        case 'running-config':
          if (!a.done) {
            a.kw(['interface']);
            const n = a.ifName();
            const lines = genRun(d);
            const s = lines.indexOf('interface ' + n.name);
            if (s < 0) throw new CliError('invalid', n.pos);
            out.push('Building configuration...', '', 'Current configuration :', ...lines.slice(s, lines.indexOf('!', s)), 'end');
            return;
          }
          if (NC.isHost(d)) a.bad();
          out.push(...runningText(d));
          return;
        case 'startup-config':
          if (!d.startup) out.push('startup-config is not present');
          else out.push('Using ' + d.startup.join('\n').length + ' bytes', ...d.startup);
          return;
        case 'version':
          out.push(
            d.type === 'router'
              ? 'Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.2(4)M5, RELEASE SOFTWARE (fc2)'
              : 'Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)',
            'Technical Support: http://www.cisco.com/techsupport',
            '',
            d.hostname + ' uptime is 1 hours, 3 minutes',
            'System image file is "flash:' + (d.type === 'router' ? 'c2900-universalk9-mz.SPA.152-4.M5.bin' : 'c2960-lanbasek9-mz.150-2.SE4.bin') + '"',
            '',
            'cisco ' + (d.type === 'router' ? 'CISCO2911/K9' : 'WS-C2960-24TT-L') + ' processor with 491520K bytes of memory.',
            'Configuration register is 0x2102'
          );
          return;
        case 'history':
          out.push(...this.history.map((h) => '  ' + h));
          return;
        case 'clock':
          out.push('*' + new Date().toUTCString());
          return;
        case 'arp': {
          out.push('Protocol  Address          Age (min)  Hardware Addr   Type   Interface');
          for (const i of NC.sortedIfaces(d)) if (i.ip != null && NC.ifUp(d, i)) out.push('Internet  ' + pad(intToIp(i.ip), 17) + pad('-', 11) + pad(NC.macOf(d, i), 16) + 'ARPA   ' + i.name);
          return;
        }
        case 'vlan':
          this.needSwitch(a, 0);
          a.optKw(['brief']);
          out.push(...showVlanBrief(d));
          return;
        case 'spanning-tree': {
          this.needSwitch(a, 0);
          let v = null;
          if (a.optKw(['vlan'])) v = a.num(1, 4094);
          a.optKw(['summary', 'detail']);
          out.push(...showStp(net, d, v));
          return;
        }
        case 'etherchannel':
          this.needSwitch(a, 0);
          a.optKw(['summary']);
          out.push(...showEtherchannel(d));
          return;
        case 'ipv6': {
          const k2 = a.kw(['interface', 'route']);
          if (k2 === 'interface') {
            a.optKw(['brief']);
            out.push(...showIpv6Brief(d));
          } else out.push(...showIpv6Route(net, d));
          return;
        }
        case 'access-lists':
          out.push(...showAcls(d));
          return;
        case 'cdp':
          a.kw(['neighbors']);
          out.push(...showCdp(d));
          return;
        case 'interfaces': {
          if (a.done) {
            out.push(...showInterfaces(net, d));
            return;
          }
          const t = a.peek().toLowerCase();
          if ('trunk'.startsWith(t) && t.length >= 2) {
            a.i++;
            out.push(...showTrunk(d));
            return;
          }
          if ('status'.startsWith(t) && t.length >= 2) {
            a.i++;
            this.needSwitch(a, 0);
            out.push(...showIntStatus(d));
            return;
          }
          const n = a.ifName();
          const r = showInterfaces(net, d, n.name);
          if (!r) throw new CliError('invalid', n.pos);
          out.push(...r);
          return;
        }
        case 'ip': {
          const k2 = a.kw(['interface', 'route', 'ospf', 'nat', 'dhcp', 'ssh', 'protocols']);
          if (k2 === 'interface') {
            a.kw(['brief']);
            out.push(...showIpIntBrief(d));
          } else if (k2 === 'route') out.push(...showIpRoute(net, d));
          else if (k2 === 'ospf') {
            if (a.done) return void out.push(...showOspf(net, d));
            const k3 = a.kw(['neighbor', 'interface']);
            if (k3 === 'neighbor') out.push(...showOspfNbr(net, d));
            else out.push(...showOspf(net, d));
          } else if (k2 === 'nat') {
            a.kw(['translations']);
            out.push(...showNat(d));
          } else if (k2 === 'dhcp') {
            const k3 = a.kw(['binding', 'pool']);
            if (k3 === 'binding') out.push(...showDhcpBinding(net, d));
            else
              for (const p of Object.values(d.dhcp.pools))
                out.push('Pool ' + p.name + ' :', ' Network ' + (p.network != null ? intToIp(p.network) + ' / ' + intToIp(p.mask) : '(not set)'), ' Default router ' + (p.router != null ? intToIp(p.router) : '(not set)'));
          } else if (k2 === 'ssh') {
            out.push(d.rsa ? 'SSH Enabled - version ' + (d.sshVersion === 2 ? '2.0' : '1.99') : 'SSH Disabled - version 1.99', 'Authentication timeout: 120 secs; Authentication retries: 3');
          } else {
            out.push('Routing Protocol is "ospf' + (d.ospf ? ' ' + d.ospf.pid : '') + '"');
          }
          return;
        }
      }
    },
    ping(a, res) {
      const tok = a.cur();
      if (tok.t.toLowerCase() === 'ip' || tok.t.toLowerCase() === 'ipv6') a.i++;
      let dst;
      const t1 = a.cur();
      if (t1.t.includes(':')) {
        dst = ip6Parse(t1.t);
        if (dst === null) throw new CliError('invalid', t1.pos);
        a.i++;
      } else dst = a.ip();
      let src = null;
      if (a.optKw(['source'])) {
        const t = a.cur();
        const ipv = ipToInt(t.t);
        if (ipv != null) {
          a.i++;
          src = ipv;
        } else {
          const n = a.ifName();
          const i = this.dev.ifaces[n.name];
          if (!i || i.ip == null) throw new CliError('invalid', n.pos);
          src = i.ip;
        }
      }
      a.optKw(['repeat']) && a.num(1, 1000);
      const r = NC.ping(this.net, this.dev, dst, { record: true, src });
      const key = this.devId + '>' + dst;
      let marks;
      if (r.ok) {
        marks = this.net.pingSeen.has(key) ? '!!!!!' : '.!!!!';
        this.net.pingSeen.add(key);
      } else if (r.fwd && r.fwd.reason === 'unreach') marks = 'U.U.U';
      else if (r.fwd && r.fwd.reason === 'acl' && r.fwd.dev !== this.dev) marks = 'U.U.U';
      else marks = '.....';
      const okN = marks.split('!').length - 1;
      res.out.push('Type escape sequence to abort.', 'Sending 5, 100-byte ICMP Echos to ' + fmtAny(dst) + ', timeout is 2 seconds:', marks);
      res.out.push('Success rate is ' + okN * 20 + ' percent (' + okN + '/5)' + (okN ? ', round-trip min/avg/max = 0/0/1 ms' : ''));
      res.events.push({ type: 'ping', ok: r.ok, fwd: r.fwd ? r.fwd.path : [], rev: r.rev ? r.rev.path : [] });
    },
    traceroute(a, res) {
      if (a.peek() && /^ipv?6?$/i.test(a.peek()) && !a.peek().includes('.')) a.i++;
      let dst;
      const t1 = a.cur();
      if (t1.t.includes(':')) {
        dst = ip6Parse(t1.t);
        if (dst === null) throw new CliError('invalid', t1.pos);
        a.i++;
      } else dst = a.ip();
      const t = NC.trace(this.net, this.dev, dst);
      res.out.push('Type escape sequence to abort.', 'Tracing the route to ' + fmtAny(dst), 'VRF info: (vrf in name/id, vrf out name/id)');
      let n = 0;
      for (const h of t.hops) {
        n++;
        res.out.push(lpad(n, 3) + ' ' + (h.ok && h.ip != null ? fmtAny(h.ip) + ' 0 msec 0 msec 1 msec' : '*  *  *'));
      }
      if (!t.complete) for (let k = 0; k < 3; k++) res.out.push(lpad(++n, 3) + '  *  *  *');
      res.events.push({ type: 'ping', ok: !!t.complete, fwd: t.fwd.path, rev: [] });
    },
    copy(a, res) {
      const src = a.kw(['running-config', 'startup-config']);
      const dst = a.kw(['startup-config', 'running-config']);
      if (src === 'running-config' && dst === 'startup-config') {
        const d = this.dev;
        this.pending = {
          prompt: 'Destination filename [startup-config]? ',
          fn(_, r) {
            d.startup = genRun(d);
            r.out.push('Building configuration...', '[OK]');
          },
        };
      } else if (src === 'startup-config' && dst === 'running-config') {
        if (!this.dev.startup) return void res.out.push('%Error opening nvram:/startup-config (No such file or directory)');
        applyLines(this.net, this.devId, this.dev.startup);
        res.out.push(this.dev.startup.join('\n').length + ' bytes copied in 0.416 secs');
      } else a.bad();
    },
    write(a, res) {
      if (!a.done) a.kw(['memory']);
      this.dev.startup = genRun(this.dev);
      res.out.push('Building configuration...', '[OK]');
    },
    erase(a, res) {
      a.kw(['startup-config', 'nvram:']);
      const d = this.dev;
      this.pending = {
        prompt: 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]',
        fn(ans, r) {
          if (ans && !/^y/i.test(ans)) return;
          d.startup = null;
          r.out.push('[OK]', 'Erase of nvram: complete');
        },
      };
    },
    reload(a, res) {
      const d = this.dev;
      const doReload = function (r) {
        const nd = NC.rebootDevice(this.net, this.devId);
        if (nd.startup) applyLines(this.net, this.devId, nd.startup, false, true);
        this.mode = 'user';
        this.ctx = {};
        r.out.push('', 'System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)', 'Initializing Hardware ...', 'Readonly ROMMON initialized', '', 'Restricted Rights Legend', '...', nd.startup ? 'Press RETURN to get started!' : '         --- System Configuration Dialog ---\n\nWould you like to enter the initial configuration dialog? [yes/no]: no\n\nPress RETURN to get started!', '');
        r.events.push({ type: 'reload' });
      };
      const confirm = {
        prompt: 'Proceed with reload? [confirm]',
        fn(ans, r) {
          if (ans && !/^y/i.test(ans)) return;
          doReload.call(this, r);
        },
      };
      const modified = !d.startup || genRun(d).join('\n') !== d.startup.join('\n');
      if (modified) {
        this.pending = {
          prompt: 'System configuration has been modified. Save? [yes/no]: ',
          fn(ans, r) {
            if (/^y/i.test(ans)) {
              d.startup = genRun(d);
              r.out.push('Building configuration...', '[OK]');
            } else if (!/^n/i.test(ans)) {
              r.out.push('% Please answer \'yes\' or \'no\'.');
              return;
            }
            this.pending = confirm;
          },
        };
      } else this.pending = confirm;
    },
    clear(a, res) {
      a.kw(['ip']);
      const k = a.kw(['nat', 'ospf']);
      if (k === 'nat') {
        a.kw(['translation']);
        a.kw(['*']);
        this.dev.natTable = [];
      } else {
        a.kw(['process']);
        this.pending = { prompt: 'Reset ALL OSPF processes? [no]: ', fn() {} };
      }
    },
  };

  // ------------------------------------------------------------ config commands
  const common = {
    end() {
      this.mode = 'priv';
      this.ctx = {};
    },
    exit() {
      if (this.mode === 'config') this.mode = 'priv';
      else this.mode = 'config';
      this.ctx = {};
    },
  };

  const CONFIG = {
    ...common,
    hostname(a, neg) {
      const d = this.dev;
      if (neg) {
        d.hostname = d.type === 'router' ? 'Router' : 'Switch';
        return;
      }
      const tok = a.cur();
      const name = a.next();
      if (!/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(name)) throw new CliError('invalid', tok.pos);
      a.end();
      d.hostname = name;
    },
    interface(a, neg) {
      const d = this.dev;
      if (a.optKw(['range'])) {
        const tok = a.cur();
        const spec = a.rest().replace(/\s*-\s*/g, '-').replace(/\s*,\s*/g, ',').replace(/\s+/g, '');
        const ifs = [];
        for (const part of spec.split(',')) {
          const m = part.toLowerCase().match(/^([a-z]+)(\d+\/)(\d+)(?:-(\d+))?$/);
          if (!m) throw new CliError('invalid', tok.pos);
          const base = canonIf(m[1] + m[2] + m[3]);
          if (!base) throw new CliError('invalid', tok.pos);
          const prefix = base.slice(0, base.lastIndexOf('/') + 1);
          const s = Number(m[3]),
            e = m[4] ? Number(m[4]) : s;
          for (let n = s; n <= e; n++) {
            const i = d.ifaces[prefix + n];
            if (!i || i.kind !== 'phys') throw new CliError('invalid', tok.pos);
            ifs.push(i);
          }
        }
        if (!ifs.length) throw new CliError('incomplete');
        this.mode = 'if';
        this.ctx = { ifs };
        return;
      }
      const n = a.ifName();
      a.end();
      const name = n.name;
      let i = d.ifaces[name];
      if (neg) {
        if (i && i.kind === 'po') {
          for (const p of NC.physPorts(d)) if (p.channel && p.channel.group === Number(name.slice(12))) p.channel = null;
          delete d.ifaces[name];
        } else if (i && (i.kind === 'sub' || i.kind === 'loop' || (i.kind === 'svi' && name !== 'Vlan1'))) delete d.ifaces[name];
        else throw new CliError('invalid', n.pos);
        return;
      }
      if (!i) {
        let m;
        if (d.type === 'router' && (m = name.match(/^(GigabitEthernet0\/[0-2])\.(\d+)$/))) {
          const parent = d.ifaces[m[1]];
          i = NC.addIface(d, NC.newIface(name, 'sub', { parent }));
        } else if (d.type === 'router' && /^Loopback\d+$/.test(name)) {
          i = NC.addIface(d, NC.newIface(name, 'loop'));
        } else if (d.type === 'switch' && (m = name.match(/^Port-channel(\d+)$/)) && Number(m[1]) >= 1 && Number(m[1]) <= 6) {
          i = NC.addIface(d, NC.newIface(name, 'po'));
        } else if (d.type === 'switch' && (m = name.match(/^Vlan(\d+)$/)) && Number(m[1]) >= 1 && Number(m[1]) <= 4094) {
          i = NC.addIface(d, NC.newIface(name, 'svi', { shutdown: !this.boot }));
        } else throw new CliError('invalid', n.pos);
      }
      this.mode = 'if';
      this.ctx = { ifs: [i] };
    },
    vlan(a, neg) {
      this.needSwitch(a, 0);
      const tok = a.cur();
      const set = parseVlanList(a.next());
      if (!set) throw new CliError('invalid', tok.pos);
      a.end();
      const d = this.dev;
      if (neg) {
        for (const v of set) if (v !== 1) d.vlans.delete(v);
        return;
      }
      for (const v of set) if (!d.vlans.has(v)) d.vlans.set(v, 'VLAN' + String(v).padStart(4, '0'));
      this.mode = 'vlan';
      this.ctx = { vlans: [...set] };
    },
    router(a, neg, res) {
      this.needRouter(a, 0);
      const tok = a.cur();
      const proto = a.kw(['ospf', 'rip', 'eigrp']);
      if (proto !== 'ospf') {
        res.out.push('% このゲームでは OSPF のみ対応しています (CCNA の出題範囲は OSPFv2 です)');
        return;
      }
      const pid = a.num(1, 65535);
      a.end();
      const d = this.dev;
      if (neg) {
        if (d.ospf && d.ospf.pid === pid) d.ospf = null;
        return;
      }
      if (d.ospf && d.ospf.pid !== pid) {
        res.out.push('% このゲームでは OSPF プロセスは 1 つまでです (現在: router ospf ' + d.ospf.pid + ')');
        return;
      }
      if (!d.ospf) d.ospf = { pid, routerId: null, networks: [], passive: new Set(), noPassive: new Set(), passiveDefault: false, defaultOriginate: false };
      this.mode = 'router';
      this.ctx = {};
      void tok;
    },
    ip(a, neg, res) {
      const d = this.dev;
      const tok = a.cur();
      const k = a.kw(['route', 'default-gateway', 'domain-name', 'domain', 'dhcp', 'nat', 'access-list', 'ssh', 'routing', 'domain-lookup', 'name-server', 'http', 'classless', 'cef']);
      switch (k) {
        case 'route': {
          this.needRouter(a, tok.pos);
          const net = a.ip();
          const mt = a.cur();
          const mask = a.mask();
          if (netOf(net, mask) !== net) {
            res.out.push('%Inconsistent address and mask');
            return;
          }
          let iface = null,
            nh = null,
            ad = 1;
          if (!a.done && ipToInt(a.peek()) === null && /^[a-zA-Z]/.test(a.peek())) {
            const n = a.ifName();
            if (!d.ifaces[n.name]) throw new CliError('invalid', n.pos);
            iface = n.name;
          }
          if (!a.done && ipToInt(a.peek()) !== null) nh = a.ip();
          if (iface === null && nh === null) {
            if (neg) {
              d.staticRoutes = d.staticRoutes.filter((r) => !(r.net === net && r.mask === mask));
              return;
            }
            throw new CliError('incomplete');
          }
          if (!a.done) ad = a.num(1, 255);
          a.end();
          void mt;
          const same = (r) => r.net === net && r.mask === mask && r.nh === nh && r.iface === iface;
          if (neg) {
            d.staticRoutes = d.staticRoutes.filter((r) => !same(r));
            return;
          }
          const ex = d.staticRoutes.find(same);
          if (ex) ex.ad = ad;
          else d.staticRoutes.push({ net, mask, nh, iface, ad });
          return;
        }
        case 'default-gateway':
          if (neg) {
            d.defaultGateway = null;
            return;
          }
          d.defaultGateway = a.ip();
          a.end();
          return;
        case 'domain': {
          const k2 = a.kw(['name', 'lookup']);
          if (k2 === 'lookup') return;
          if (neg) {
            d.domainName = null;
            return;
          }
          d.domainName = a.next();
          a.end();
          return;
        }
        case 'domain-name':
          if (neg) {
            d.domainName = null;
            return;
          }
          d.domainName = a.next();
          a.end();
          return;
        case 'domain-lookup':
        case 'name-server':
        case 'http':
        case 'classless':
        case 'cef':
          while (!a.done) a.next();
          return;
        case 'routing':
          return;
        case 'ssh': {
          const k2 = a.kw(['version', 'time-out', 'authentication-retries']);
          if (k2 !== 'version') {
            while (!a.done) a.next();
            return;
          }
          if (neg) {
            d.sshVersion = null;
            return;
          }
          const v = a.num(1, 2);
          a.end();
          if (!d.rsa) {
            res.out.push('Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).');
            return;
          }
          d.sshVersion = v;
          return;
        }
        case 'dhcp': {
          this.needRouter(a, tok.pos);
          const k2 = a.kw(['pool', 'excluded-address']);
          if (k2 === 'pool') {
            const name = a.next();
            a.end();
            if (neg) {
              delete d.dhcp.pools[name];
              return;
            }
            if (!d.dhcp.pools[name]) d.dhcp.pools[name] = { name, network: null, mask: null, router: null, dns: null };
            this.mode = 'dhcp';
            this.ctx = { pool: d.dhcp.pools[name] };
            return;
          }
          const lo = a.ip();
          const hi = a.done ? lo : a.ip();
          a.end();
          if (neg) {
            d.dhcp.excluded = d.dhcp.excluded.filter((x) => !(x.lo === lo && x.hi === hi));
            return;
          }
          if (hi < lo) {
            res.out.push('% Invalid range');
            return;
          }
          if (!d.dhcp.excluded.some((x) => x.lo === lo && x.hi === hi)) d.dhcp.excluded.push({ lo, hi });
          return;
        }
        case 'nat': {
          this.needRouter(a, tok.pos);
          const k2 = a.kw(['inside', 'pool']);
          if (k2 === 'pool') {
            const name = a.next();
            if (neg && a.done) {
              delete d.nat.pools[name];
              return;
            }
            const start = a.ip(),
              end = a.ip();
            a.kw(['netmask']);
            const mask = a.mask();
            a.end();
            if (neg) delete d.nat.pools[name];
            else d.nat.pools[name] = { name, start, end, mask };
            return;
          }
          a.kw(['source']);
          const k3 = a.kw(['list', 'static']);
          let rule;
          if (k3 === 'static') {
            const local = a.ip(),
              global = a.ip();
            a.end();
            rule = { type: 'static', local, global };
          } else {
            const at = a.cur();
            const acl = a.next();
            void at;
            const k4 = a.kw(['interface', 'pool']);
            rule = { type: 'list', acl, overload: false };
            if (k4 === 'interface') {
              const n = a.ifName();
              if (!d.ifaces[n.name]) throw new CliError('invalid', n.pos);
              rule.iface = n.name;
            } else rule.pool = a.next();
            if (a.optKw(['overload'])) rule.overload = true;
            a.end();
          }
          const same = (r) =>
            r.type === rule.type && (r.type === 'static' ? r.local === rule.local : r.acl === rule.acl);
          d.nat.rules = d.nat.rules.filter((r) => !same(r));
          if (!neg) d.nat.rules.push(rule);
          return;
        }
        case 'access-list': {
          const type = a.kw(['standard', 'extended']);
          const tk = a.cur();
          const name = a.next();
          a.end();
          if (/^\d+$/.test(name) && aclTypeOf(Number(name)) !== type) throw new CliError('invalid', tk.pos);
          if (neg) {
            delete d.acls[name];
            return;
          }
          if (d.acls[name] && d.acls[name].type !== type) {
            res.out.push('% A named ' + d.acls[name].type + ' IP access list with this name already exists');
            return;
          }
          const acl = this.getAcl(name, type, !/^\d+$/.test(name));
          this.mode = 'acl';
          this.ctx = { acl };
          return;
        }
      }
    },
    'access-list'(a, neg) {
      const d = this.dev;
      const tok = a.cur();
      const n = a.num(1, 2699);
      const type = aclTypeOf(n);
      if (!type) throw new CliError('invalid', tok.pos);
      const name = String(n);
      if (neg) {
        delete d.acls[name];
        return;
      }
      const action = a.kw(['permit', 'deny', 'remark']);
      if (action === 'remark') {
        const text = a.rest();
        const acl = this.getAcl(name, type, false);
        acl.entries.push({ remark: text, seq: 0 });
        return;
      }
      const e = parseAce(a, type, action);
      const acl = this.getAcl(name, type, false);
      const last = acl.entries.filter((x) => x.remark == null).pop();
      e.seq = last ? last.seq + 10 : 10;
      acl.entries.push(e);
    },
    enable(a, neg) {
      const d = this.dev;
      const k = a.kw(['secret', 'password']);
      if (neg) {
        if (k === 'secret') d.enableSecret = null;
        else d.enablePassword = null;
        return;
      }
      let pw;
      const t = a.peek();
      if (k === 'secret' && (t === '5' || t === '0' || t === '9') && a.toks.length > a.i + 1) {
        a.i++;
        const v = a.next();
        pw = t === '0' ? secretHash(v) : v;
      } else if (k === 'secret') pw = secretHash(a.next());
      else if ((t === '7' || t === '0') && a.toks.length > a.i + 1) {
        a.i++;
        const v = a.next();
        pw = t === '7' ? type7dec(v) : v;
      } else pw = a.next();
      a.end();
      if (k === 'secret') d.enableSecret = pw;
      else d.enablePassword = pw;
    },
    line(a, neg) {
      const k = a.kw(['console', 'vty', 'aux']);
      const s = a.num(0, 15);
      if (!a.done) a.num(s, 15);
      a.end();
      this.mode = 'line';
      this.ctx = { line: k === 'console' ? 'con' : k === 'vty' ? 'vty' : 'aux', obj: k === 'aux' ? {} : this.dev.lines[k === 'console' ? 'con' : 'vty'] };
    },
    service(a, neg) {
      const k = a.kw(['password-encryption', 'timestamps', 'dhcp']);
      while (!a.done) a.next();
      if (k === 'password-encryption') this.dev.servicePwEnc = !neg;
    },
    banner(a, neg) {
      a.kw(['motd', 'login']);
      if (neg) {
        this.dev.banner = null;
        return;
      }
      const raw = a.rest();
      let delim, body;
      if (raw.startsWith('^C')) {
        delim = '^C';
        body = raw.slice(2);
      } else {
        delim = raw[0];
        body = raw.slice(1);
      }
      const e = body.indexOf(delim);
      this.dev.banner = e >= 0 ? body.slice(0, e) : body;
    },
    username(a, neg) {
      const d = this.dev;
      const name = a.next();
      if (neg) {
        delete d.users[name];
        return;
      }
      if (a.optKw(['privilege'])) a.num(0, 15);
      const k = a.kw(['secret', 'password']);
      const t = a.peek();
      let v;
      if (t && /^[0579]$/.test(t) && a.toks.length > a.i + 1) {
        a.i++;
        v = a.next();
        if (k === 'secret' && t === '0') v = secretHash(v);
        if (k === 'password' && t === '7') v = type7dec(v);
      } else {
        v = a.next();
        if (k === 'secret') v = secretHash(v);
      }
      a.end();
      d.users[name] = k === 'secret' ? { name, secret: v } : { name, password: v };
    },
    crypto(a, neg, res) {
      const d = this.dev;
      a.kw(['key']);
      const k = a.kw(['generate', 'zeroize']);
      a.kw(['rsa']);
      if (k === 'zeroize') {
        d.rsa = null;
        d.sshVersion = null;
        return;
      }
      a.optKw(['general-keys']);
      let bits = null;
      if (a.optKw(['modulus'])) bits = a.num(360, 4096);
      a.end();
      if (/^(Router|Switch)$/.test(d.hostname)) {
        res.out.push('% Please define a hostname other than ' + d.hostname + '.');
        return;
      }
      if (!d.domainName) {
        res.out.push('% Please define a domain-name first.');
        return;
      }
      const gen = (b, r) => {
        d.rsa = b;
        r.out.push(
          '% The key modulus size is ' + b + ' bits',
          '% Generating ' + b + ' bit RSA keys, keys will be non-exportable...[OK]',
          '*Mar 1 0:12:31.524: %SSH-5-ENABLED: SSH ' + (b >= 768 ? '1.99' : '1.5') + ' has been enabled'
        );
      };
      res.out.push('The name for the keys will be: ' + d.hostname + '.' + d.domainName);
      if (bits) gen(bits, res);
      else {
        res.out.push(
          'Choose the size of the key modulus in the range of 360 to 4096 for your',
          '  General Purpose Keys. Choosing a key modulus greater than 512 may take',
          '  a few minutes.',
          ''
        );
        this.pending = {
          prompt: 'How many bits in the modulus [512]: ',
          fn(ans, r) {
            const b = ans ? Number(ans) : 512;
            if (!Number.isInteger(b) || b < 360 || b > 4096) return void r.out.push('% Invalid modulus');
            gen(b, r);
          },
        };
      }
    },
    ipv6(a, neg, res) {
      const tok = a.cur();
      this.needRouter(a, tok.pos);
      const d = this.dev;
      const k = a.kw(['unicast-routing', 'route']);
      if (k === 'unicast-routing') {
        a.end();
        d.ipv6Routing = !neg;
        return;
      }
      const pt = a.cur();
      const pfx = parsePfx6(a.next());
      if (!pfx) throw new CliError('invalid', pt.pos);
      const net = pfx.addr & mask6(pfx.plen);
      let iface = null,
        nh = null,
        ad = 1;
      if (!a.done && ip6Parse(a.peek()) === null && /^[a-zA-Z]/.test(a.peek())) {
        const n = a.ifName();
        if (!d.ifaces[n.name]) throw new CliError('invalid', n.pos);
        iface = n.name;
      }
      if (!a.done && ip6Parse(a.peek()) !== null) nh = ip6Parse(a.next());
      if (iface === null && nh === null) {
        if (neg) {
          d.staticRoutes6 = d.staticRoutes6.filter((r) => !(r.net === net && r.plen === pfx.plen));
          return;
        }
        throw new CliError('incomplete');
      }
      if (!a.done) ad = a.num(1, 254);
      a.end();
      const same = (r) => r.net === net && r.plen === pfx.plen && r.nh === nh && r.iface === iface;
      d.staticRoutes6 = d.staticRoutes6.filter((r) => !same(r));
      if (!neg) d.staticRoutes6.push({ net, plen: pfx.plen, nh, iface, ad });
    },
    'spanning-tree'(a, neg, res) {
      const d = this.dev;
      if (d.type !== 'switch') {
        while (!a.done) a.next();
        return;
      }
      const k = a.kw(['mode', 'vlan', 'portfast', 'extend', 'loopguard', 'backbonefast', 'uplinkfast']);
      if (k === 'mode') {
        const m = neg ? 'pvst' : a.kw(['pvst', 'rapid-pvst', 'mst']);
        a.end();
        if (m === 'mst') return void res.out.push('% このゲームでは MST は未対応です (pvst / rapid-pvst を使用してください)');
        d.stp.mode = m;
        return;
      }
      if (k !== 'vlan') {
        while (!a.done) a.next();
        return;
      }
      const lt = a.cur();
      const set = parseVlanList(a.next());
      if (!set) throw new CliError('invalid', lt.pos);
      const k2 = a.kw(['priority', 'root', 'hello-time', 'forward-time', 'max-age']);
      if (k2 === 'priority') {
        if (neg) {
          for (const v of set) d.stp.prio.delete(v);
          return;
        }
        const n = a.num(0, 61440);
        a.end();
        if (n % 4096) {
          res.out.push('% Bridge Priority must be in increments of 4096.', '% Allowed values are:', '  0     4096  8192  12288 16384 20480 24576 28672', '  32768 36864 40960 45056 49152 53248 57344 61440');
          return;
        }
        for (const v of set) d.stp.prio.set(v, n);
        return;
      }
      if (k2 === 'root') {
        if (neg) {
          for (const v of set) d.stp.prio.delete(v);
          return;
        }
        const r = a.kw(['primary', 'secondary']);
        while (!a.done) a.next();
        for (const v of set) {
          if (r === 'secondary') {
            d.stp.prio.set(v, 28672);
            continue;
          }
          const I = NC.computeStp(this.net, v)[d.id];
          const rootBase = I ? I.best.root[0] - v : 32768;
          const isMe = I && !I.rootPort;
          let pr = 24576;
          if (!isMe && rootBase <= 24576) pr = Math.max(0, rootBase - 4096);
          d.stp.prio.set(v, pr);
        }
        return;
      }
      while (!a.done) a.next();
    },
    cdp(a) {
      while (!a.done) a.next();
    },
  };

  function ensureL3Port(self, i, pos) {
    if (self.dev.type === 'switch' && i.kind === 'phys') throw new CliError('invalid', pos);
  }

  const IFACE = {
    ...common,
    ip(a, neg, res) {
      const tok = a.cur();
      const k = a.kw(['address', 'access-group', 'nat', 'ospf', 'helper-address', 'redirects', 'proxy-arp']);
      const d = this.dev;
      switch (k) {
        case 'address': {
          for (const i of this.ctx.ifs) ensureL3Port(this, i, tok.pos);
          if (neg) {
            this.eachIf((i) => {
              i.ip = null;
              i.mask = null;
            });
            while (!a.done) a.next();
            return;
          }
          const ipv = a.ip();
          const mask = a.mask();
          a.end();
          const i = this.ctx.ifs[0];
          if (this.ctx.ifs.length > 1) throw new CliError('invalid', tok.pos);
          const n = netOf(ipv, mask);
          const pfx = maskToPrefix(mask);
          if (pfx < 31 && (ipv === n || ipv === bcastOf(n, mask))) {
            res.out.push('Bad mask /' + pfx + ' for address ' + intToIp(ipv));
            return;
          }
          if (i.kind === 'sub' && i.encap == null) {
            res.out.push(
              '',
              '% Configuring IP routing on a LAN subinterface is only allowed if that',
              'subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,',
              'or ISL vLAN.',
              ''
            );
            return;
          }
          for (const o of Object.values(d.ifaces)) {
            if (o === i || o.ip == null) continue;
            const m = o.mask > mask ? mask : o.mask;
            if (inSubnet(o.ip, ipv, m) && (d.type === 'router' || o.kind === 'svi')) {
              res.out.push('% ' + intToIp(n) + ' overlaps with ' + o.name);
              return;
            }
          }
          i.ip = ipv;
          i.mask = mask;
          return;
        }
        case 'access-group': {
          this.needRouter(a, tok.pos);
          const name = a.next();
          if (neg && a.done) {
            this.eachIf((i) => {
              if (i.aclIn === name) i.aclIn = null;
              if (i.aclOut === name) i.aclOut = null;
            });
            return;
          }
          const dir = a.kw(['in', 'out']);
          a.end();
          this.eachIf((i) => {
            if (dir === 'in') i.aclIn = neg ? null : name;
            else i.aclOut = neg ? null : name;
          });
          return;
        }
        case 'nat': {
          this.needRouter(a, tok.pos);
          const side = a.kw(['inside', 'outside']);
          a.end();
          this.eachIf((i) => (i.nat = neg ? null : side));
          return;
        }
        case 'ospf': {
          a.kw(['cost']);
          if (neg) {
            this.eachIf((i) => (i.ospfCost = null));
            return;
          }
          const c = a.num(1, 65535);
          a.end();
          this.eachIf((i) => (i.ospfCost = c));
          return;
        }
        case 'helper-address': {
          if (neg) {
            this.eachIf((i) => (i.helper = null));
            return;
          }
          const h = a.ip();
          a.end();
          this.eachIf((i) => (i.helper = h));
          return;
        }
        default:
          return;
      }
    },
    shutdown(a, neg) {
      a.end();
      this.eachIf((i) => (i.shutdown = !neg));
    },
    description(a, neg) {
      if (neg) {
        this.eachIf((i) => (i.desc = ''));
        return;
      }
      const t = a.rest();
      this.eachIf((i) => (i.desc = t));
    },
    switchport(a, neg, res) {
      this.needSwitch(a, 0);
      for (const i of this.ctx.ifs) if (i.kind !== 'phys' && i.kind !== 'po') throw new CliError('invalid', a.toks[0].pos);
      const k = a.kw(['mode', 'access', 'trunk', 'nonegotiate', 'port-security', 'voice']);
      const d = this.dev;
      if (k === 'mode') {
        if (neg) {
          this.eachIf((i) => (i.mode = null));
          while (!a.done) a.next();
          return;
        }
        let m = a.kw(['access', 'trunk', 'dynamic']);
        if (m === 'dynamic') m = 'dynamic ' + a.kw(['auto', 'desirable']);
        a.end();
        this.eachIf((i) => (i.mode = m));
      } else if (k === 'access') {
        a.kw(['vlan']);
        if (neg) {
          this.eachIf((i) => (i.accessVlan = 1));
          while (!a.done) a.next();
          return;
        }
        const v = a.num(1, 4094);
        a.end();
        if (!d.vlans.has(v)) {
          res.out.push('% Access VLAN does not exist. Creating vlan ' + v);
          d.vlans.set(v, 'VLAN' + String(v).padStart(4, '0'));
        }
        this.eachIf((i) => (i.accessVlan = v));
      } else if (k === 'trunk') {
        const k2 = a.kw(['native', 'allowed', 'encapsulation']);
        if (k2 === 'encapsulation') {
          a.kw(['dot1q']);
          return;
        }
        a.kw(['vlan']);
        if (k2 === 'native') {
          if (neg) {
            this.eachIf((i) => (i.nativeVlan = 1));
            return;
          }
          const v = a.num(1, 4094);
          a.end();
          this.eachIf((i) => (i.nativeVlan = v));
          return;
        }
        if (neg) {
          this.eachIf((i) => (i.allowed = null));
          return;
        }
        const tk = a.cur();
        const op = a.optKw(['add', 'remove', 'except', 'all', 'none']);
        if (op === 'all') {
          a.end();
          this.eachIf((i) => (i.allowed = null));
          return;
        }
        if (op === 'none') {
          a.end();
          this.eachIf((i) => (i.allowed = new Set()));
          return;
        }
        const lt = a.cur();
        const set = parseVlanList(a.next());
        if (!set) throw new CliError('invalid', lt.pos);
        a.end();
        void tk;
        this.eachIf((i) => {
          const cur = i.allowed ? new Set(i.allowed) : null;
          if (!op) i.allowed = set;
          else if (op === 'add') {
            if (cur) for (const v of set) cur.add(v);
            i.allowed = cur;
          } else if (op === 'remove') {
            const base = cur || new Set(Array.from({ length: 4094 }, (_, k) => k + 1));
            for (const v of set) base.delete(v);
            i.allowed = base;
          } else if (op === 'except') {
            i.allowed = new Set(Array.from({ length: 4094 }, (_, k) => k + 1).filter((v) => !set.has(v)));
          }
        });
      } else {
        while (!a.done) a.next();
      }
    },
    encapsulation(a, neg, res) {
      const tok = a.cur();
      a.kw(['dot1q']);
      const i = this.ctx.ifs[0];
      if (i.kind !== 'sub') throw new CliError('invalid', tok.pos);
      if (neg) {
        i.encap = null;
        return;
      }
      const v = a.num(1, 4094);
      a.optKw(['native']);
      a.end();
      i.encap = v;
    },
    duplex(a) {
      while (!a.done) a.next();
    },
    speed(a) {
      while (!a.done) a.next();
    },
    negotiation(a) {
      while (!a.done) a.next();
    },
    'spanning-tree'(a, neg, res) {
      if (this.dev.type !== 'switch') {
        while (!a.done) a.next();
        return;
      }
      const k = a.kw(['portfast', 'bpduguard', 'cost', 'port-priority', 'guard', 'link-type', 'vlan']);
      if (k === 'portfast') {
        const opt = a.optKw(['edge', 'disable', 'trunk']);
        a.optKw(['trunk']);
        a.end();
        const on = !neg && opt !== 'disable';
        this.eachIf((i) => (i.portfast = on));
        if (on)
          res.out.push(
            '%Warning: portfast should only be enabled on ports connected to a single',
            ' host. Connecting hubs, concentrators, switches, bridges, etc... to this',
            ' interface  when portfast is enabled, can cause temporary bridging loops.',
            ' Use with CAUTION',
            '',
            '%Portfast has been configured on ' + this.ctx.ifs[0].name + (this.ctx.ifs.length > 1 ? ' (and others)' : '') + ' but will only',
            ' have effect when the interface is in a non-trunking mode.'
          );
        return;
      }
      if (k === 'bpduguard') {
        const e = neg ? 'disable' : a.kw(['enable', 'disable']);
        while (!a.done) a.next();
        this.eachIf((i) => (i.bpduguard = e === 'enable'));
        return;
      }
      while (!a.done) a.next();
    },
    'channel-group'(a, neg, res) {
      this.needSwitch(a, 0);
      const d = this.dev;
      for (const i of this.ctx.ifs) if (i.kind !== 'phys') throw new CliError('invalid', a.toks[0].pos);
      if (neg) {
        while (!a.done) a.next();
        this.eachIf((i) => (i.channel = null));
        return;
      }
      const g = a.num(1, 6);
      a.kw(['mode']);
      const mode = a.kw(['active', 'passive', 'on', 'desirable', 'auto']);
      a.end();
      let po = d.ifaces['Port-channel' + g];
      for (const i of this.ctx.ifs) {
        if (!po) {
          po = NC.addIface(d, NC.newIface('Port-channel' + g, 'po'));
          copyL2(i, po);
          res.out.push('Creating a port-channel interface Port-channel ' + g);
        } else copyL2(po, i);
        i.channel = { group: g, mode };
      }
    },
    ipv6(a, neg, res) {
      const tok = a.cur();
      this.needRouter(a, tok.pos);
      const k = a.kw(['address', 'enable']);
      if (k === 'enable') {
        a.end();
        this.eachIf((i) => (i.v6en = !neg));
        return;
      }
      if (neg) {
        while (!a.done) a.next();
        this.eachIf((i) => (i.ip6 = null));
        return;
      }
      const pt = a.cur();
      const pfx = parsePfx6(a.next());
      if (!pfx || pfx.plen === 0) throw new CliError('invalid', pt.pos);
      a.end();
      if (this.ctx.ifs.length > 1) throw new CliError('invalid', tok.pos);
      this.ctx.ifs[0].ip6 = pfx;
    },
    bandwidth(a) {
      while (!a.done) a.next();
    },
  };

  const ROUTER = {
    ...common,
    network(a, neg) {
      const net = a.ip();
      const wc = a.ip();
      a.kw(['area']);
      const at = a.cur();
      let area;
      if (/^\d+$/.test(at.t)) area = a.num(0, 4294967295);
      else {
        const v = a.ip();
        area = v;
      }
      a.end();
      const o = this.dev.ospf;
      const base = (net & ~wc) >>> 0;
      const same = (n) => n.net === base && n.wc === wc;
      if (neg) {
        o.networks = o.networks.filter((n) => !same(n));
        return;
      }
      const ex = o.networks.find(same);
      if (ex) ex.area = area;
      else o.networks.push({ net: base, wc, area });
    },
    'router-id'(a, neg) {
      if (neg) {
        this.dev.ospf.routerId = null;
        return;
      }
      this.dev.ospf.routerId = a.ip();
      a.end();
    },
    'passive-interface'(a, neg) {
      const o = this.dev.ospf;
      if (a.optKw(['default'])) {
        o.passiveDefault = !neg;
        o.noPassive.clear();
        o.passive.clear();
        return;
      }
      const n = a.ifName();
      a.end();
      if (!this.dev.ifaces[n.name]) throw new CliError('invalid', n.pos);
      if (o.passiveDefault) {
        if (neg) o.noPassive.add(n.name);
        else o.noPassive.delete(n.name);
      } else if (neg) o.passive.delete(n.name);
      else o.passive.add(n.name);
    },
    'default-information'(a, neg) {
      a.kw(['originate']);
      const always = a.optKw(['always']);
      a.end();
      this.dev.ospf.defaultOriginate = neg ? false : always ? 'always' : true;
    },
    'auto-cost'(a) {
      while (!a.done) a.next();
    },
    'log-adjacency-changes'(a) {
      while (!a.done) a.next();
    },
  };

  const VLAN = {
    ...common,
    name(a, neg) {
      const d = this.dev;
      for (const v of this.ctx.vlans) {
        if (neg) d.vlans.set(v, 'VLAN' + String(v).padStart(4, '0'));
      }
      if (neg) return;
      const tok = a.cur();
      const n = a.next();
      a.end();
      if (n.length > 32) throw new CliError('invalid', tok.pos);
      for (const v of this.ctx.vlans) d.vlans.set(v, n);
    },
  };

  const LINE = {
    ...common,
    password(a, neg) {
      const l = this.ctx.obj;
      if (neg) {
        l.password = null;
        return;
      }
      const t = a.peek();
      if ((t === '7' || t === '0') && a.toks.length > a.i + 1) {
        a.i++;
        const v = a.next();
        l.password = t === '7' ? type7dec(v) : v;
      } else l.password = a.next();
      a.end();
    },
    login(a, neg, res) {
      const l = this.ctx.obj;
      if (neg) {
        l.login = null;
        return;
      }
      const loc = a.optKw(['local']);
      a.end();
      if (!loc && !l.password) res.out.push('% Login disabled on line, until \'password\' is set');
      l.login = loc ? 'local' : 'password';
    },
    transport(a, neg) {
      a.kw(['input', 'output']);
      const l = this.ctx.obj;
      if (neg) {
        l.transport = null;
        return;
      }
      const list = [];
      while (!a.done) list.push(a.kw(['ssh', 'telnet', 'all', 'none']));
      if (!list.length) throw new CliError('incomplete');
      l.transport = list.join(' ');
    },
    'exec-timeout'(a) {
      while (!a.done) a.next();
    },
    logging(a) {
      while (!a.done) a.next();
    },
    'access-class'(a) {
      while (!a.done) a.next();
    },
    history(a) {
      while (!a.done) a.next();
    },
    privilege(a) {
      while (!a.done) a.next();
    },
  };

  const DHCP = {
    ...common,
    network(a, neg) {
      const p = this.ctx.pool;
      if (neg) {
        p.network = null;
        p.mask = null;
        return;
      }
      const n = a.ip();
      let mask;
      const t = a.cur();
      if (/^\/\d+$/.test(t.t)) {
        a.i++;
        mask = prefixToMask(Number(t.t.slice(1)));
      } else mask = a.mask();
      a.end();
      p.network = netOf(n, mask);
      p.mask = mask;
    },
    'default-router'(a, neg) {
      if (neg) {
        this.ctx.pool.router = null;
        return;
      }
      this.ctx.pool.router = a.ip();
      while (!a.done) a.ip();
    },
    'dns-server'(a, neg) {
      if (neg) {
        this.ctx.pool.dns = null;
        return;
      }
      this.ctx.pool.dns = a.ip();
      while (!a.done) a.ip();
    },
    'domain-name'(a) {
      while (!a.done) a.next();
    },
    lease(a) {
      while (!a.done) a.next();
    },
  };

  function aclEntryCmd(action) {
    return function (a, neg) {
      const acl = this.ctx.acl;
      if (neg) {
        const e = parseAce(a, acl.type, action);
        const txt = aceText(acl, e);
        acl.entries = acl.entries.filter((x) => aceText(acl, x) !== txt);
        return;
      }
      const e = parseAce(a, acl.type, action);
      const last = acl.entries.filter((x) => x.remark == null).pop();
      e.seq = this.ctx.seq || (last ? last.seq + 10 : 10);
      this.ctx.seq = null;
      acl.entries.push(e);
      acl.entries.sort((x, y) => (x.remark != null || y.remark != null ? 0 : x.seq - y.seq));
    };
  }
  const ACL = {
    ...common,
    permit: aclEntryCmd('permit'),
    deny: aclEntryCmd('deny'),
    remark(a, neg) {
      if (neg) return;
      this.ctx.acl.entries.push({ remark: a.rest(), seq: 0 });
    },
  };

  const CMD = { config: CONFIG, if: IFACE, router: ROUTER, vlan: VLAN, line: LINE, dhcp: DHCP, acl: ACL };

  // 番号付きシーケンス ("10 deny ...") / "no 10" を ACL モードで扱う
  const origRunTable = IosSession.prototype.runTable;
  IosSession.prototype.runTable = function (mode, a, res) {
    if (mode === 'acl') {
      const t0 = a.toks[a.i];
      if (t0 && /^\d+$/.test(t0.t)) {
        this.ctx.seq = Number(t0.t);
        a.i++;
      } else if (t0 && t0.t.toLowerCase() === 'no' && a.toks[a.i + 1] && /^\d+$/.test(a.toks[a.i + 1].t)) {
        const seq = Number(a.toks[a.i + 1].t);
        this.ctx.acl.entries = this.ctx.acl.entries.filter((e) => e.seq !== seq || e.remark != null);
        return;
      }
    }
    return origRunTable.call(this, mode, a, res);
  };

  /** 設定行を流し込む (レベル初期設定 / reload) */
  function applyLines(net, devId, lines, strict, boot) {
    const s = new IosSession(net, devId);
    s.mode = 'config';
    s.boot = !!boot;
    const errors = [];
    for (const raw of lines) {
      const l = raw.replace(/\s+$/, '');
      const t = l.trim();
      if (!t || t.startsWith('!') || t === 'end' || /^(version|Building|Current configuration)/.test(t)) continue;
      const r = s.exec(l);
      if (r.out && /Invalid input|Incomplete command|Ambiguous command|overlaps|Bad mask/.test(r.out)) errors.push(t + ' => ' + r.out.trim());
      if (s.mode === 'priv' || s.mode === 'user') s.mode = 'config';
    }
    NC.touch(net);
    if (strict && errors.length) throw new Error(devId + ': ' + errors.join('\n'));
    return errors;
  }

  // ------------------------------------------------------------ PC session
  class PcSession {
    constructor(net, devId) {
      this.net = net;
      this.devId = devId;
      this.history = [];
      this.pending = null;
    }
    get dev() {
      return this.net.devices[this.devId];
    }
    get secretInput() {
      return false;
    }
    prompt() {
      return 'C:\\>';
    }
    help() {
      return [
        'Available Commands:',
        '  ipconfig                     IP 設定を表示',
        '  ipconfig <IP> <マスク> [GW]  静的 IP を設定',
        '  ipconfig /dhcp (/renew)      DHCP で IP を取得',
        '  ipconfig /release            IP を解放',
        '  ipv6config <IPv6>/<長さ> [GW] IPv6 アドレスを設定',
        '  ipv6config autoconfig        IPv6 を自動設定 (SLAAC)',
        '  ping <IP>                    疎通確認',
        '  tracert <IP>                 経路確認',
        '  arp -a                       ARP テーブル',
        '  cls                          画面クリア',
      ].join('\n');
    }
    complete(line) {
      const opts = ['ipconfig', 'ipv6config', 'ping', 'tracert', 'arp', 'cls', 'help'];
      const t = line.trim().toLowerCase();
      if (!t || /\s/.test(t)) return line;
      const m = opts.filter((o) => o.startsWith(t));
      return m.length === 1 ? m[0] + ' ' : line;
    }
    showIp() {
      const d = this.dev,
        i = d.ifaces.FastEthernet0;
      return [
        '',
        'FastEthernet0 Connection:(default port)',
        '',
        '   Connection-specific DNS Suffix..: ',
        '   Link-local IPv6 Address.........: ' + ip6Str(linkLocal(d, i)),
        '   IPv6 Address....................: ' + (i.ip6 ? ip6Str(i.ip6.addr) + '/' + i.ip6.plen : '::'),
        '   IPv4 Address....................: ' + (i.ip != null ? intToIp(i.ip) : '0.0.0.0'),
        '   Subnet Mask.....................: ' + (i.mask != null ? intToIp(i.mask) : '0.0.0.0'),
        '   Default Gateway.................: ' + (d.gateway6 != null ? ip6Str(d.gateway6) : '::'),
        '                                     ' + (d.gateway != null ? intToIp(d.gateway) : '0.0.0.0'),
        '',
      ];
    }
    exec(raw) {
      const res = { out: [], events: [] };
      const line = raw.trim();
      if (!line) return { out: '', events: [] };
      if (line === '?' || /\s\?$/.test(line)) return { out: this.help(), events: [] };
      this.history.push(line);
      const t = line.split(/\s+/);
      const cmd = t[0].toLowerCase();
      const d = this.dev,
        nic = d.ifaces.FastEthernet0;
      if (cmd === 'ipv6config') {
        if (t.length === 1) res.out.push(...this.showIp());
        else if (/^(autoconfig|\/autoconfig|auto)$/i.test(t[1])) {
          const r = NC.slaac(this.net, d);
          res.out.push(r.ok ? 'IPv6 autoconfiguration successful.' : 'IPv6 autoconfiguration failed. (ルーター通知 RA を受信できませんでした)', ...this.showIp());
        } else {
          const pfx = parsePfx6(t[1]);
          const gw = t[2] ? ip6Parse(t[2]) : null;
          if (!pfx || (t[2] && gw === null) || t.length > 3) res.out.push('Invalid command. 使い方: ipv6config <IPv6アドレス>/<プレフィックス長> [ゲートウェイ]');
          else {
            nic.ip6 = pfx;
            d.gateway6 = gw;
            d.v6on = true;
            res.out.push(...this.showIp());
          }
        }
      } else if (cmd === 'ipconfig' || cmd === 'ip') {
        if (t.length === 1 || t[1].toLowerCase() === '/all') res.out.push(...this.showIp());
        else if (/^\/(dhcp|renew)$/i.test(t[1]) || t[1].toLowerCase() === 'dhcp') {
          const r = NC.dhcpRequest(this.net, d);
          if (r.ok) res.out.push('DHCP request successful.', ...this.showIp());
          else res.out.push('DHCP request failed. (DHCP サーバーから応答がありません)', ...this.showIp());
        } else if (t[1].toLowerCase() === '/release') {
          nic.ip = null;
          nic.mask = null;
          d.gateway = null;
          res.out.push(...this.showIp());
        } else {
          const ipv = ipToInt(t[1]);
          const mask = t[2] ? ipToInt(t[2]) : null;
          const gw = t[3] ? ipToInt(t[3]) : null;
          if (ipv === null || mask === null || maskToPrefix(mask) === null || (t[3] && gw === null) || t.length > 4) {
            res.out.push('Invalid command. 使い方: ipconfig <IPアドレス> <サブネットマスク> [デフォルトゲートウェイ]');
            if (/\//.test(line)) res.tip = 'マスクは /24 ではなく 255.255.255.0 のように書きます (例: ipconfig 192.168.1.10 255.255.255.0 192.168.1.1)';
          } else {
            nic.ip = ipv;
            nic.mask = mask;
            d.gateway = gw;
            d.dhcpClient = false;
            res.out.push(...this.showIp());
          }
        }
      } else if (cmd === 'ping') {
        const last = t[t.length - 1] || '';
        const dst = last.includes(':') ? ip6Parse(last) : ipToInt(last);
        if (t.length < 2 || dst === null) res.out.push('Ping request could not find host. Please check the name and try again.');
        else {
          const r = NC.ping(this.net, d, dst, { record: true });
          res.out.push('', 'Pinging ' + fmtAny(dst) + ' with 32 bytes of data:', '');
          let rx = 0;
          for (let k = 0; k < 4; k++) {
            if (r.ok) {
              rx++;
              res.out.push('Reply from ' + fmtAny(dst) + ': bytes=32 time<1ms TTL=' + r.ttl);
            } else if (r.fwd && (r.fwd.reason === 'unreach' || r.fwd.reason === 'acl') && r.fwd.replyIp != null)
              res.out.push('Reply from ' + fmtAny(r.fwd.replyIp) + ': Destination host unreachable.');
            else res.out.push('Request timed out.');
          }
          res.out.push(
            '',
            'Ping statistics for ' + fmtAny(dst) + ':',
            '    Packets: Sent = 4, Received = ' + rx + ', Lost = ' + (4 - rx) + ' (' + (4 - rx) * 25 + '% loss),'
          );
          if (rx) res.out.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 1ms, Average = 0ms');
          res.events.push({ type: 'ping', ok: r.ok, fwd: r.fwd ? r.fwd.path : [], rev: r.rev ? r.rev.path : [] });
        }
      } else if (cmd === 'tracert' || cmd === 'traceroute') {
        const dst = (t[1] || '').includes(':') ? ip6Parse(t[1]) : ipToInt(t[1] || '');
        if (dst === null) res.out.push('Invalid command.');
        else {
          const tr = NC.trace(this.net, d, dst);
          res.out.push('', 'Tracing route to ' + fmtAny(dst) + ' over a maximum of 30 hops: ', '');
          let n = 0;
          for (const h of tr.hops) {
            n++;
            res.out.push(lpad(n, 3) + '   ' + (h.ok && h.ip != null ? '0 ms      0 ms      0 ms      ' + fmtAny(h.ip) : '*         *         *         Request timed out.'));
          }
          if (!tr.complete) for (let k = 0; k < 3; k++) res.out.push(lpad(++n, 3) + '   *         *         *         Request timed out.');
          res.out.push('', 'Trace complete.');
          res.events.push({ type: 'ping', ok: !!tr.complete, fwd: tr.fwd.path, rev: [] });
        }
      } else if (cmd === 'arp') {
        res.out.push('', 'Interface: ' + (nic.ip != null ? intToIp(nic.ip) : '0.0.0.0') + ' --- 0x1', '  Internet Address      Physical Address      Type');
        if (d.gateway != null) res.out.push('  ' + pad(intToIp(d.gateway), 22) + pad('00d0.97a1.0c01', 22) + 'dynamic');
      } else if (cmd === 'cls' || cmd === 'clear') {
        res.events.push({ type: 'clear' });
      } else if (cmd === 'help' || cmd === '?') {
        res.out.push(this.help());
      } else if (cmd === 'enable' || cmd === 'configure' || cmd === 'conf') {
        res.out.push('Invalid Command.  (PC では IOS コマンドは使えません。help でコマンド一覧)');
      } else res.out.push('Invalid Command.  (help でコマンド一覧を表示)');
      NC.touch(this.net);
      return { out: res.out.join('\n'), events: res.events, tip: res.tip || null };
    }
  }

  function newSession(net, devId) {
    return NC.isHost(net.devices[devId]) ? new PcSession(net, devId) : new IosSession(net, devId);
  }

  /** デバイスに一連のコマンドを投入 (PC は PC コマンド、IOS は exec から) */
  function runScript(net, devId, cmds) {
    const s = newSession(net, devId);
    const outs = [];
    for (const c of cmds) outs.push(s.exec(c).out);
    return outs;
  }

  // ------------------------------------------------------------ syslog 風イベント
  function snapshot(net) {
    const snap = {};
    for (const d of Object.values(net.devices)) {
      if (NC.isHost(d)) continue;
      const s = { ifs: {}, nbrs: new Set() };
      for (const i of Object.values(d.ifaces)) s.ifs[i.name] = { st: NC.ifStatus(d, i), admin: i.shutdown };
      const info = NC.computeOspf(net)[d.id];
      if (info) for (const n of info.nbrs) s.nbrs.add(n.rid + '|' + n.local.name);
      snap[d.id] = s;
    }
    return snap;
  }
  function diffLogs(net, before, after) {
    const logs = {};
    const ts = () => {
      const t = new Date();
      return '*' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getMonth()] + ' ' + t.getDate() + ' ' + t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0') + ': ';
    };
    for (const id in after) {
      const A = after[id],
        B = before[id];
      if (!B) continue;
      const out = [];
      const d = net.devices[id];
      for (const name in A.ifs) {
        const a = A.ifs[name],
          b = B.ifs[name];
        if (!b) continue;
        const i = d.ifaces[name];
        const physical = i.kind === 'phys' || i.kind === 'loop';
        if (physical && (a.st[0] !== b.st[0])) out.push(ts() + '%LINK-' + (a.st[0] === 'administratively down' ? '5' : '3') + '-UPDOWN: Interface ' + name + ', changed state to ' + a.st[0]);
        if (a.st[1] !== b.st[1]) out.push(ts() + '%LINEPROTO-5-UPDOWN: Line protocol on Interface ' + name + ', changed state to ' + a.st[1]);
      }
      const pid = d.ospf ? d.ospf.pid : '1';
      for (const n of A.nbrs)
        if (!B.nbrs.has(n)) {
          const [rid, ifn] = n.split('|');
          out.push(ts() + '%OSPF-5-ADJCHG: Process ' + pid + ', Nbr ' + intToIp(Number(rid)) + ' on ' + ifn + ' from LOADING to FULL, Loading Done');
        }
      for (const n of B.nbrs)
        if (!A.nbrs.has(n)) {
          const [rid, ifn] = n.split('|');
          out.push(ts() + '%OSPF-5-ADJCHG: Process ' + pid + ', Nbr ' + intToIp(Number(rid)) + ' on ' + ifn + ' from FULL to DOWN, Neighbor Down: Interface down or detached');
        }
      if (out.length) logs[id] = out;
    }
    return logs;
  }

  Object.assign(NC, {
    IosSession,
    PcSession,
    newSession,
    runScript,
    applyLines,
    genRun,
    runningText,
    secretHash,
    type7enc,
    type7dec,
    snapshot,
    diffLogs,
    fmtVlanList,
  });
})(typeof window !== 'undefined' ? window : globalThis);
