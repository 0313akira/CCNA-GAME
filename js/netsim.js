/* =========================================================================
 * netsim.js — ネットワークシミュレーションエンジン
 *   デバイス / インターフェース / L2(VLAN・トランク) / L3(ルーティング・OSPF)
 *   ping 転送 / ACL / NAT / DHCP
 * ========================================================================= */
(function (G) {
  'use strict';
  const NC = (G.NC = G.NC || {});

  // ------------------------------------------------------------------ IP utils
  function ipToInt(s) {
    if (typeof s !== 'string') return null;
    const p = s.split('.');
    if (p.length !== 4) return null;
    let n = 0;
    for (const x of p) {
      if (!/^\d{1,3}$/.test(x)) return null;
      const v = Number(x);
      if (v > 255) return null;
      n = n * 256 + v;
    }
    return n;
  }
  function intToIp(n) {
    if (n === null || n === undefined) return 'unassigned';
    n = n >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  function prefixToMask(p) {
    if (p <= 0) return 0;
    if (p >= 32) return 0xffffffff;
    return (0xffffffff << (32 - p)) >>> 0;
  }
  function maskToPrefix(m) {
    if (m === null || m === undefined) return null;
    m = m >>> 0;
    let p = 0;
    while (p < 32 && m & (0x80000000 >>> p)) p++;
    return prefixToMask(p) === m ? p : null;
  }
  const netOf = (ip, mask) => (ip & mask) >>> 0;
  const inSubnet = (a, net, mask) => ((a ^ net) & mask) === 0;
  const wcMatch = (a, base, wc) => ((a ^ base) & ~wc) === 0;
  const bcastOf = (net, mask) => (net | ~mask) >>> 0;
  function classfulPrefix(n) {
    const o = n >>> 24;
    if (o < 128) return 8;
    if (o < 192) return 16;
    return 24;
  }
  NC.ip = { ipToInt, intToIp, prefixToMask, maskToPrefix, netOf, inSubnet, wcMatch, bcastOf, classfulPrefix };

  // ----------------------------------------------------- interface name utils
  const IF_TYPES = [
    // [lower, Full, cdp, short, rank]
    ['port-channel', 'Port-channel', 'Por', 'Po', -1],
    ['fastethernet', 'FastEthernet', 'Fas', 'Fa', 0],
    ['gigabitethernet', 'GigabitEthernet', 'Gig', 'Gi', 1],
    ['loopback', 'Loopback', 'Loo', 'Lo', 2],
    ['vlan', 'Vlan', 'Vla', 'Vl', 3],
  ];
  function canonIf(str) {
    const s = String(str).replace(/\s+/g, '').toLowerCase();
    const m = s.match(/^([a-z-]+)(\d[\d/.]*)$/);
    if (!m) return null;
    const t = IF_TYPES.find((x) => x[0].startsWith(m[1]));
    if (!t) return null;
    return t[1] + m[2];
  }
  function ifType(name) {
    return IF_TYPES.find((t) => name.startsWith(t[1]));
  }
  function shortIf(name) {
    const t = ifType(name);
    return t ? t[3] + name.slice(t[1].length) : name;
  }
  function cdpIf(name) {
    const t = ifType(name);
    return t ? t[2] + ' ' + name.slice(t[1].length) : name;
  }
  function ifKey(name) {
    const t = ifType(name);
    const nums = (name.match(/\d+/g) || []).map(Number);
    return [t ? t[4] : 9].concat(nums);
  }
  function cmpIf(a, b) {
    const ka = ifKey(a.name || a),
      kb = ifKey(b.name || b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if (ka[i] === undefined) return -1;
      if (kb[i] === undefined) return 1;
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  }
  NC.ifname = { canonIf, shortIf, cdpIf, cmpIf };

  // ------------------------------------------------------------ device model
  function newIface(name, kind, extra) {
    return Object.assign(
      {
        name,
        kind, // phys | sub | svi | loop | po
        ip: null,
        mask: null,
        shutdown: false,
        desc: '',
        mode: null, // switchport: null(dynamic auto) | access | trunk | dynamic auto | dynamic desirable
        accessVlan: 1,
        nativeVlan: 1,
        allowed: null, // null = all
        encap: null,
        parent: null,
        aclIn: null,
        aclOut: null,
        nat: null,
        ospfCost: null,
        helper: null,
        ip6: null,
        channel: null,
        portfast: false,
        bpduguard: false,
        peer: null,
      },
      extra || {}
    );
  }

  function resetConfig(d) {
    d.hostname = d.type === 'router' ? 'Router' : d.type === 'switch' ? 'Switch' : d.id;
    d.staticRoutes = [];
    d.ospf = null;
    d.acls = {};
    d.nat = { rules: [], pools: {} };
    d.natTable = [];
    d.dhcp = { pools: {}, excluded: [], bindings: {} };
    d.defaultGateway = null;
    d.enableSecret = null;
    d.enablePassword = null;
    d.servicePwEnc = false;
    d.banner = null;
    d.lines = {
      con: { password: null, login: null },
      vty: { password: null, login: null, transport: null },
    };
    d.domainName = null;
    d.users = {};
    d.rsa = null;
    d.sshVersion = null;
    d.startup = null;
    d.gateway = null;
    d.dns = null;
    d.dhcpClient = false;
    d.ipv6Routing = false;
    d.staticRoutes6 = [];
    d.gateway6 = null;
    d.stp = { mode: 'pvst', prio: new Map() };
  }

  function addIface(d, i) {
    d.ifaces[i.name] = i;
    return i;
  }

  function makeDevice(spec) {
    const d = {
      id: spec.id,
      type: spec.type, // router | switch | pc | server
      x: spec.x,
      y: spec.y,
      locked: !!spec.locked,
      ifaces: {},
    };
    resetConfig(d);
    if (d.type === 'router') {
      for (let i = 0; i < 3; i++) addIface(d, newIface('GigabitEthernet0/' + i, 'phys', { shutdown: true }));
    } else if (d.type === 'switch') {
      for (let i = 1; i <= 24; i++) addIface(d, newIface('FastEthernet0/' + i, 'phys'));
      for (let i = 1; i <= 2; i++) addIface(d, newIface('GigabitEthernet0/' + i, 'phys'));
      addIface(d, newIface('Vlan1', 'svi', { shutdown: true }));
      d.vlans = new Map([[1, 'default']]);
    } else {
      addIface(d, newIface('FastEthernet0', 'phys'));
    }
    return d;
  }

  function sortedIfaces(d) {
    return Object.values(d.ifaces).sort(cmpIf);
  }
  function physPorts(d) {
    return sortedIfaces(d).filter((i) => i.kind === 'phys');
  }
  function subIfacesOf(d, parent) {
    return Object.values(d.ifaces).filter((i) => i.kind === 'sub' && i.parent === parent);
  }
  const isHost = (d) => d.type === 'pc' || d.type === 'server';

  function wire(net) {
    for (const d of Object.values(net.devices)) for (const i of Object.values(d.ifaces)) i.peer = null;
    for (const [a, ai, b, bi] of net.links) {
      const A = net.devices[a],
        B = net.devices[b];
      const IA = A.ifaces[ai],
        IB = B.ifaces[bi];
      if (!IA || !IB) throw new Error('bad link ' + [a, ai, b, bi].join(' '));
      IA.peer = { dev: B, iface: IB };
      IB.peer = { dev: A, iface: IA };
    }
  }

  function buildNet(devSpecs, links) {
    const net = { devices: {}, links: [], specs: {}, _cache: null, pingSeen: new Set(), seen: new Set() };
    for (const s of devSpecs) {
      net.devices[s.id] = makeDevice(s);
      net.specs[s.id] = s;
    }
    for (const [a, ai, b, bi] of links) {
      net.links.push([a, canonIf(ai), b, canonIf(bi)]);
    }
    wire(net);
    return net;
  }

  /** 工場出荷状態に戻してから起動コンフィグを流し込む (reload) */
  function rebootDevice(net, id) {
    const old = net.devices[id];
    const d = makeDevice(net.specs[id]);
    if (old.vlans) d.vlans = new Map(old.vlans); // vlan.dat は保持
    d.rsa = old.rsa; // RSA 鍵は NVRAM に保持
    d.startup = old.startup;
    // 起動コンフィグがある場合、"shutdown" 行が無いインターフェースは up で起動する
    if (d.startup) for (const i of Object.values(d.ifaces)) i.shutdown = false;
    net.devices[id] = d;
    wire(net);
    touch(net);
    return d;
  }

  function touch(net) {
    net._cache = null;
  }
  function cache(net) {
    if (!net._cache) net._cache = { rt: {}, rt6: {}, ospf: null, stp: {}, ch: {} };
    return net._cache;
  }

  // ------------------------------------------------------------ link status
  function linkUp(d, i) {
    if (i.kind !== 'phys' || i.shutdown || !i.peer) return false;
    return !i.peer.iface.shutdown;
  }
  function opMode(d, i) {
    if (d.type !== 'switch' || i.kind !== 'phys') return null;
    const m = i.mode || 'dynamic auto';
    if (m === 'access' || m === 'trunk') return m;
    const p = i.peer;
    if (p && p.dev.type === 'switch') {
      const pm = p.iface.mode || 'dynamic auto';
      if (m === 'dynamic desirable' && (pm === 'trunk' || pm.startsWith('dynamic'))) return 'trunk';
      if (m === 'dynamic auto' && (pm === 'trunk' || pm === 'dynamic desirable')) return 'trunk';
    }
    return 'access';
  }
  const trunkAllows = (i, v) => i.allowed === null || i.allowed.has(v);
  function vlanHasActivePort(sw, v) {
    return physPorts(sw).some(
      (p) => linkUp(sw, p) && (opMode(sw, p) === 'access' ? p.accessVlan === v : trunkAllows(p, v))
    );
  }
  function ifUp(d, i) {
    switch (i.kind) {
      case 'phys':
        return linkUp(d, i);
      case 'sub':
        return !i.shutdown && linkUp(d, i.parent);
      case 'loop':
        return !i.shutdown;
      case 'svi': {
        const v = Number(i.name.slice(4));
        return !i.shutdown && d.vlans.has(v) && vlanHasActivePort(d, v);
      }
      case 'po':
        return !i.shutdown && channelInfo(d, Number(i.name.slice(12))).bundled.length > 0;
    }
    return false;
  }
  function ifStatus(d, i) {
    if (i.shutdown) return ['administratively down', 'down'];
    return ifUp(d, i) ? ['up', 'up'] : ['down', 'down'];
  }

  // ------------------------------------------------------------ L2 domain
  /**
   * L3 インターフェースから出たフレームが届く L3 インターフェースを列挙
   * (VLAN / アクセス / トランク / ネイティブ VLAN / サブインターフェースを考慮)
   */
  function l2Domain(net, dev, iface) {
    const res = [];
    const seenSV = new Set();
    const seenEP = new Set();
    const addEP = (d, i, path) => {
      const k = d.id + '|' + i.name;
      if (seenEP.has(k)) return;
      seenEP.add(k);
      res.push({ dev: d, iface: i, path });
    };
    function deliver(d, port, tag, path) {
      if (!linkUp(d, port)) return;
      const pd = port.peer.dev,
        pi = port.peer.iface;
      const np = path.concat(pd.id);
      if (pd.type === 'switch') {
        const om = opMode(pd, pi);
        let v;
        if (om === 'access') {
          if (tag !== null) return;
          v = pi.accessVlan;
        } else {
          v = tag === null ? pi.nativeVlan : tag;
          if (!trunkAllows(pi, v)) return;
        }
        if (stpRole(net, pd, pi, v) === 'Altn') return;
        visitVlan(pd, v, np);
      } else if (pd.type === 'router') {
        if (tag === null) addEP(pd, pi, np);
        else for (const s of subIfacesOf(pd, pi)) if (s.encap === tag && !s.shutdown) addEP(pd, s, np);
      } else if (tag === null) addEP(pd, pi, np);
    }
    function visitVlan(sw, v, path) {
      const k = sw.id + '|' + v;
      if (seenSV.has(k)) return;
      seenSV.add(k);
      if (!sw.vlans.has(v)) return;
      const svi = sw.ifaces['Vlan' + v];
      if (svi && !svi.shutdown) addEP(sw, svi, path);
      for (const p of physPorts(sw)) {
        if (!linkUp(sw, p)) continue;
        const b = bundleOf(sw, p);
        if (b && !b.primary) continue;
        if (stpRole(net, sw, p, v) === 'Altn') continue;
        if (opMode(sw, p) === 'access') {
          if (p.accessVlan === v) deliver(sw, p, null, path);
        } else if (trunkAllows(p, v)) deliver(sw, p, v === p.nativeVlan ? null : v, path);
      }
    }
    if (iface.kind === 'svi') visitVlan(dev, Number(iface.name.slice(4)), [dev.id]);
    else if (iface.kind === 'sub') {
      if (!iface.shutdown && iface.encap != null) deliver(dev, iface.parent, iface.encap, [dev.id]);
    } else if (iface.kind === 'phys') deliver(dev, iface, null, [dev.id]);
    return res;
  }

  // ------------------------------------------------------------ OSPF
  function ospfIfaces(d) {
    if (!d.ospf) return [];
    const out = [];
    for (const i of sortedIfaces(d)) {
      if (i.ip == null || !ifUp(d, i)) continue;
      const st = d.ospf.networks.find((n) => wcMatch(i.ip, n.net, n.wc));
      if (!st) continue;
      const loop = i.kind === 'loop';
      out.push({
        iface: i,
        area: st.area,
        cost: i.ospfCost || 1,
        passive: d.ospf.passiveDefault ? !d.ospf.noPassive.has(i.name) : d.ospf.passive.has(i.name),
        net: loop ? i.ip : netOf(i.ip, i.mask),
        mask: loop ? 0xffffffff : i.mask,
        loop,
      });
    }
    return out;
  }
  function routerId(d) {
    if (!d.ospf) return null;
    if (d.ospf.routerId != null) return d.ospf.routerId;
    const ups = sortedIfaces(d).filter((i) => i.ip != null && ifUp(d, i));
    const loops = ups.filter((i) => i.kind === 'loop');
    const pool = loops.length ? loops : ups;
    if (!pool.length) return null;
    return Math.max(...pool.map((i) => i.ip));
  }
  function computeOspf(net) {
    const c = cache(net);
    if (c.ospf) return c.ospf;
    const info = {};
    for (const d of Object.values(net.devices)) {
      if (d.type !== 'router' || !d.ospf) continue;
      info[d.id] = { dev: d, rid: routerId(d), oifs: ospfIfaces(d), nbrs: [] };
    }
    for (const id in info) {
      const R = info[id];
      if (R.rid == null) continue;
      for (const oi of R.oifs) {
        if (oi.passive || oi.loop) continue;
        for (const ep of l2Domain(net, R.dev, oi.iface)) {
          const S = info[ep.dev.id];
          if (!S || S === R || S.rid == null || S.rid === R.rid) continue;
          const so = S.oifs.find((x) => x.iface === ep.iface);
          if (!so || so.passive || so.area !== oi.area || so.net !== oi.net || so.mask !== oi.mask) continue;
          R.nbrs.push({ id: ep.dev.id, rid: S.rid, addr: ep.iface.ip, local: oi.iface, cost: oi.cost });
        }
      }
    }
    // DR/BDR 表示用の役割
    for (const id in info) {
      const R = info[id];
      const byIf = new Map();
      for (const n of R.nbrs) {
        if (!byIf.has(n.local)) byIf.set(n.local, []);
        byIf.get(n.local).push(n);
      }
      for (const [, list] of byIf) {
        const rids = [R.rid].concat(list.map((n) => n.rid)).sort((a, b) => b - a);
        const role = (rid) => (rids[0] === rid ? 'DR' : rids[1] === rid ? 'BDR' : 'DROTHER');
        const me = role(R.rid);
        for (const n of list) {
          n.role = role(n.rid);
          n.state = me === 'DROTHER' && n.role === 'DROTHER' ? '2WAY/DROTHER' : 'FULL/' + n.role;
        }
      }
    }
    c.ospf = info;
    return info;
  }

  function ospfRoutes(net, d, connectedKeys) {
    const info = computeOspf(net);
    const me = info[d.id];
    if (!me || me.rid == null) return [];
    const dist = { [d.id]: 0 };
    const fh = { [d.id]: [] };
    const done = new Set();
    for (;;) {
      let u = null;
      for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
      if (u === null) break;
      done.add(u);
      for (const e of info[u].nbrs) {
        // 隣接は双方向で確認
        if (!info[e.id].nbrs.some((b) => b.id === u)) continue;
        const nd = dist[u] + e.cost;
        const nfh = u === d.id ? [{ ip: e.addr, iface: e.local }] : fh[u];
        if (dist[e.id] === undefined || nd < dist[e.id]) {
          dist[e.id] = nd;
          fh[e.id] = nfh.slice();
        } else if (nd === dist[e.id]) {
          for (const h of nfh) if (!fh[e.id].some((x) => x.ip === h.ip)) fh[e.id].push(h);
        }
      }
    }
    const myAreas = new Set(me.oifs.map((o) => o.area));
    const best = new Map();
    for (const id in dist) {
      if (id === d.id) continue;
      const X = info[id];
      for (const oi of X.oifs) {
        const key = oi.net + '/' + oi.mask;
        const metric = dist[id] + oi.cost;
        const cur = best.get(key);
        if (!cur || metric < cur.metric) {
          best.set(key, {
            code: myAreas.has(oi.area) || myAreas.size === 0 ? 'O' : 'O IA',
            net: oi.net,
            mask: oi.mask,
            metric,
            via: fh[id].slice(),
          });
        } else if (metric === cur.metric) {
          for (const h of fh[id]) if (!cur.via.some((x) => x.ip === h.ip)) cur.via.push(h);
        }
      }
      if (X.dev.ospf.defaultOriginate) {
        const hasDef =
          X.dev.ospf.defaultOriginate === 'always' ||
          X.dev.staticRoutes.some((r) => r.net === 0 && r.mask === 0 && staticUsable(X.dev, r, null));
        if (hasDef) {
          const cur = best.get('0/0');
          if (!cur || dist[id] < cur.d) best.set('0/0', { code: 'O*E2', net: 0, mask: 0, metric: 1, d: dist[id], via: fh[id].slice() });
        }
      }
    }
    void connectedKeys;
    return [...best.values()];
  }

  // ------------------------------------------------------------ routing table
  function staticUsable(d, r, entries) {
    if (r.iface) {
      const i = d.ifaces[r.iface];
      if (!i || !ifUp(d, i) || i.ip == null) return false;
      if (r.nh == null) return true;
    }
    if (r.nh == null) return false;
    // 次ホップが直接接続 (または OSPF) で解決できること
    for (const i of Object.values(d.ifaces)) if (i.ip != null && ifUp(d, i) && inSubnet(r.nh, i.ip, i.mask)) return true;
    if (entries) for (const e of entries) if (e.code.startsWith('O') && e.mask !== 0 && inSubnet(r.nh, e.net, e.mask)) return true;
    return false;
  }

  function routingTable(net, d) {
    const c = cache(net);
    if (c.rt[d.id]) return c.rt[d.id];
    const cands = [];
    const connKeys = new Set();
    for (const i of sortedIfaces(d)) {
      if (i.ip == null || !ifUp(d, i)) continue;
      const n = netOf(i.ip, i.mask);
      cands.push({ code: 'C', net: n, mask: i.mask, ad: 0, metric: 0, via: [{ ip: null, iface: i }] });
      connKeys.add(n + '/' + i.mask);
      if (i.mask !== 0xffffffff)
        cands.push({ code: 'L', net: i.ip, mask: 0xffffffff, ad: 0, metric: 0, via: [{ ip: null, iface: i }] });
    }
    if (d.type === 'router' && d.ospf) {
      for (const r of ospfRoutes(net, d, connKeys)) cands.push(Object.assign({ ad: 110 }, r));
    }
    if (d.type === 'router') {
      const base = cands.slice();
      for (const r of d.staticRoutes) {
        if (!staticUsable(d, r, base)) continue;
        cands.push({
          code: r.net === 0 && r.mask === 0 ? 'S*' : 'S',
          net: r.net,
          mask: r.mask,
          ad: r.ad,
          metric: 0,
          via: [{ ip: r.nh, iface: r.iface ? d.ifaces[r.iface] : null }],
        });
      }
    }
    const best = new Map();
    for (const e of cands) {
      const key = e.net + '/' + e.mask + (e.code === 'L' ? 'L' : '');
      const cur = best.get(key);
      if (!cur || e.ad < cur.ad) best.set(key, Object.assign({}, e, { via: e.via.slice() }));
      else if (e.ad === cur.ad && e.code === cur.code && e.code[0] === 'S') cur.via.push(...e.via);
    }
    const rt = [...best.values()].map((e) => Object.assign(e, { prefix: maskToPrefix(e.mask) }));
    rt.sort((a, b) => (a.net >>> 0) - (b.net >>> 0) || a.prefix - b.prefix);
    c.rt[d.id] = rt;
    return rt;
  }

  function lpm(rt, dst) {
    let best = null;
    for (const e of rt) {
      if (e.code === 'L') continue;
      if (inSubnet(dst, e.net, e.mask) && (!best || e.prefix > best.prefix)) best = e;
    }
    return best;
  }
  function resolveVia(rt, v, target, depth) {
    if (v.iface) return { iface: v.iface, nh: v.ip != null ? v.ip : target };
    if (depth > 5 || v.ip == null) return null;
    const e = lpm(rt, v.ip);
    if (!e) return null;
    return resolveVia(rt, e.via[0], v.ip, depth + 1);
  }
  function hostL3Iface(d) {
    if (isHost(d)) return d.ifaces.FastEthernet0;
    return sortedIfaces(d).find((i) => i.kind === 'svi' && i.ip != null && ifUp(d, i)) || null;
  }
  function routeLookup(net, d, dst) {
    if (d.type !== 'router') {
      const i = hostL3Iface(d);
      if (!i || i.ip == null) return null;
      if (isHost(d) && !linkUp(d, i)) return null;
      if (inSubnet(dst, i.ip, i.mask)) return { iface: i, nh: dst };
      const gw = isHost(d) ? d.gateway : d.defaultGateway;
      if (gw != null && inSubnet(gw, i.ip, i.mask)) return { iface: i, nh: gw };
      return null;
    }
    const rt = routingTable(net, d);
    const e = lpm(rt, dst);
    if (!e) return null;
    return resolveVia(rt, e.via[0], dst, 0);
  }

  function ownsIp(d, ip) {
    for (const i of Object.values(d.ifaces)) {
      if (i.ip !== ip) continue;
      if (isHost(d) ? linkUp(d, i) : ifUp(d, i)) return true;
    }
    return false;
  }
  function answersArp(d, i, ip) {
    if (i.ip == null) return false;
    const up = isHost(d) ? linkUp(d, i) : ifUp(d, i);
    if (!up) return false;
    if (i.ip === ip) return true;
    if (d.type === 'router' && i.nat === 'outside') {
      if (d.nat.rules.some((r) => r.type === 'static' && r.global === ip)) return true;
      for (const p of Object.values(d.nat.pools)) if (ip >= p.start && ip <= p.end) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ ACL
  function aclMatchEntry(acl, e, pkt) {
    if (e.remark != null) return false;
    if (acl.type === 'standard') return wcMatch(pkt.src, e.src.base, e.src.wc);
    if (e.proto !== 'ip' && e.proto !== 'icmp') return false;
    return wcMatch(pkt.src, e.src.base, e.src.wc) && wcMatch(pkt.dst, e.dst.base, e.dst.wc);
  }
  function aclEval(acl, pkt, record) {
    const real = acl.entries.filter((e) => e.remark == null);
    if (!real.length) return 'permit';
    for (const e of real) {
      if (aclMatchEntry(acl, e, pkt)) {
        if (record) e.hits = (e.hits || 0) + 1;
        return e.action;
      }
    }
    return 'deny';
  }
  function aclCheck(d, name, pkt, ctx) {
    const acl = d.acls[name];
    if (!acl) return 'permit';
    return aclEval(acl, pkt, ctx.record);
  }

  // ------------------------------------------------------------ NAT
  function natOutbound(d, pkt, ctx) {
    let g = null,
      kind = 'dynamic';
    const st = d.nat.rules.find((r) => r.type === 'static' && r.local === pkt.src);
    if (st) {
      g = st.global;
      kind = 'static';
    } else {
      for (const r of d.nat.rules) {
        if (r.type !== 'list') continue;
        const acl = d.acls[r.acl];
        if (!acl || aclEval(acl, pkt, false) !== 'permit') continue;
        if (r.iface) {
          const ifc = d.ifaces[r.iface];
          g = ifc && ifc.ip != null ? ifc.ip : null;
        } else {
          const pool = d.nat.pools[r.pool];
          g = pool ? pool.start : null;
        }
        if (g != null) break;
      }
    }
    if (g == null) return;
    ctx.nat.push({ dev: d.id, local: pkt.src, global: g });
    if (ctx.record && kind === 'dynamic') {
      const t = d.natTable.find((x) => x.local === pkt.src && x.outside === pkt.dst);
      if (!t) d.natTable.push({ local: pkt.src, global: g, outside: pkt.dst, id: d.natTable.length + 1 });
    }
    pkt.src = g;
  }
  function natInbound(d, pkt, ctx) {
    for (let k = ctx.nat.length - 1; k >= 0; k--) {
      const t = ctx.nat[k];
      if (t.dev === d.id && t.global === pkt.dst) {
        pkt.dst = t.local;
        return;
      }
    }
    const st = d.nat.rules.find((r) => r.type === 'static' && r.global === pkt.dst);
    if (st) pkt.dst = st.local;
  }

  // ------------------------------------------------------------ forwarding
  function sendPacket(net, ctx, origin, pkt) {
    let d = origin,
      inIf = null;
    const hops = [];
    const path = [origin.id];
    const fail = (reason, dev, extra) => Object.assign({ ok: false, reason, dev, hops, path, pkt }, extra || {});
    for (let step = 0; step < 40; step++) {
      if (inIf && d.type === 'router') {
        if (inIf.aclIn && aclCheck(d, inIf.aclIn, pkt, ctx) === 'deny') return fail('acl', d, { iface: inIf });
        if (inIf.nat === 'outside') natInbound(d, pkt, ctx);
      }
      if (ownsIp(d, pkt.dst)) return { ok: true, dev: d, hops, path, pkt };
      if (inIf && d.type !== 'router') return fail('drop', d);
      if (inIf) {
        pkt.ttl--;
        if (pkt.ttl <= 0) return fail('ttl', d);
      }
      const r = routeLookup(net, d, pkt.dst);
      if (!r) return fail(inIf ? 'unreach' : 'noroute', d, { replyIp: inIf ? inIf.ip : null });
      if (pkt.src == null) pkt.src = r.iface.ip;
      if (pkt.origSrc == null) pkt.origSrc = pkt.src;
      if (d.type === 'router') {
        if (inIf && inIf.nat === 'inside' && r.iface.nat === 'outside') natOutbound(d, pkt, ctx);
        if (r.iface.aclOut && aclCheck(d, r.iface.aclOut, pkt, ctx) === 'deny')
          return fail('acl', d, { iface: r.iface, replyIp: inIf ? inIf.ip : null });
      }
      const dom = l2Domain(net, d, r.iface);
      const ep = dom.find((e) => e.dev !== d && answersArp(e.dev, e.iface, r.nh));
      if (!ep) return fail('arp', d);
      hops.push({ dev: ep.dev, iface: ep.iface, src: pkt.src });
      for (const id of ep.path.slice(1)) path.push(id);
      d = ep.dev;
      inIf = ep.iface;
    }
    return fail('loop', d);
  }

  const baseTtl = (d) => (d.type === 'router' || d.type === 'switch' ? 255 : 128);

  /** ping: 往路と復路の両方が届けば成功 */
  function ping(net, origin, dst, opts) {
    opts = opts || {};
    const ctx = { record: !!opts.record, nat: [] };
    const send = typeof dst === 'bigint' ? sendPacket6 : sendPacket;
    const fwd = send(net, ctx, origin, { src: opts.src != null ? opts.src : null, dst, ttl: baseTtl(origin) });
    if (!fwd.ok) return { ok: false, stage: 'fwd', fwd };
    if (fwd.dev === origin) return { ok: true, fwd, rev: fwd, ttl: baseTtl(origin) };
    const rev = send(net, ctx, fwd.dev, { src: fwd.pkt.dst, dst: fwd.pkt.src, ttl: baseTtl(fwd.dev) });
    const ok = rev.ok && rev.dev === origin;
    return { ok, stage: ok ? null : 'rev', fwd, rev, ttl: rev.pkt.ttl };
  }

  /** traceroute: 各ホップの応答可否も判定 */
  function trace(net, origin, dst) {
    const ctx = { record: false, nat: [] };
    const send = typeof dst === 'bigint' ? sendPacket6 : sendPacket;
    const fwd = send(net, ctx, origin, { src: null, dst, ttl: 64 });
    const src = fwd.pkt.origSrc != null ? fwd.pkt.origSrc : fwd.pkt.src;
    const out = [];
    for (let k = 0; k < fwd.hops.length; k++) {
      const h = fwd.hops[k];
      const last = fwd.ok && k === fwd.hops.length - 1;
      let ok;
      if (last) ok = ping(net, origin, dst).ok;
      else {
        const r = src == null ? { ok: false } : send(net, { record: false, nat: ctx.nat.slice() }, h.dev, { src: typeof dst === 'bigint' ? (h.iface.ip6 ? h.iface.ip6.addr : null) : h.iface.ip, dst: h.src, ttl: 64 });
        ok = r.ok && r.dev === origin;
      }
      out.push({ ip: last ? fwd.pkt.dst : typeof dst === 'bigint' ? (h.iface.ip6 ? h.iface.ip6.addr : null) : h.iface.ip, ok, dev: h.dev });
    }
    return { hops: out, complete: fwd.ok && out.length && out[out.length - 1].ok, fwd };
  }

  // ------------------------------------------------------------ DHCP
  function dhcpRequest(net, pc) {
    const nic = pc.ifaces.FastEthernet0;
    pc.dhcpClient = true;
    nic.ip = null;
    nic.mask = null;
    pc.gateway = null;
    pc.dns = null;
    touch(net);
    if (!linkUp(pc, nic)) return { ok: false };
    for (const ep of l2Domain(net, pc, nic)) {
      if (ep.dev.type !== 'router' || ep.iface.ip == null || !ifUp(ep.dev, ep.iface)) continue;
      const giaddr = ep.iface;
      let server = ep.dev;
      let pool = findPool(server, giaddr.ip);
      if (!pool && giaddr.helper != null) {
        for (const r of Object.values(net.devices)) {
          if (r.type === 'router' && ownsIp(r, giaddr.helper) && ping(net, ep.dev, giaddr.helper).ok) {
            pool = findPool(r, giaddr.ip);
            if (pool) server = r;
          }
        }
      }
      if (!pool) continue;
      const addr = allocate(net, server, pool, pc.id);
      if (addr == null) continue;
      nic.ip = addr;
      nic.mask = pool.mask;
      pc.gateway = pool.router;
      pc.dns = pool.dns;
      touch(net);
      return { ok: true, server };
    }
    return { ok: false };
  }
  /** IP を持っていない DHCP クライアントは定期的に再試行する (実機の Windows と同じ) */
  function dhcpRetry(net) {
    const got = [];
    for (const d of Object.values(net.devices)) {
      if (!isHost(d) || !d.dhcpClient || d.ifaces.FastEthernet0.ip != null) continue;
      if (dhcpRequest(net, d).ok) got.push(d.id);
    }
    return got;
  }
  function findPool(r, ip) {
    return Object.values(r.dhcp.pools).find((p) => p.network != null && inSubnet(ip, p.network, p.mask));
  }
  function allocate(net, server, pool, client) {
    const used = new Set();
    for (const d of Object.values(net.devices))
      for (const i of Object.values(d.ifaces)) if (i.ip != null && d.id !== client) used.add(i.ip);
    const b = server.dhcp.bindings;
    for (const k in b) if (k !== client) used.add(b[k].ip);
    const excluded = (a) => server.dhcp.excluded.some((x) => a >= x.lo && a <= x.hi);
    const cur = b[client];
    if (cur && inSubnet(cur.ip, pool.network, pool.mask) && !excluded(cur.ip) && !used.has(cur.ip)) return cur.ip;
    const last = bcastOf(pool.network, pool.mask);
    for (let a = pool.network + 1; a < last; a++) {
      if (excluded(a) || used.has(a)) continue;
      b[client] = { ip: a, pool: pool.name };
      return a;
    }
    return null;
  }


  // ------------------------------------------------------------ EtherChannel
  const LACP = ['active', 'passive'],
    PAGP = ['desirable', 'auto'];
  function chCompatible(a, b) {
    if (a === 'on' || b === 'on') return a === 'on' && b === 'on';
    if (LACP.includes(a) && LACP.includes(b)) return a === 'active' || b === 'active';
    if (PAGP.includes(a) && PAGP.includes(b)) return a === 'desirable' || b === 'desirable';
    return false;
  }
  const setKey = (s) => (s === null ? 'all' : [...s].sort((x, y) => x - y).join(','));
  function sameL2(a, b) {
    return a.mode === b.mode && a.accessVlan === b.accessVlan && a.nativeVlan === b.nativeVlan && setKey(a.allowed) === setKey(b.allowed);
  }
  function channelInfo(d, g) {
    const po = d.ifaces['Port-channel' + g] || null;
    const members = physPorts(d).filter((p) => p.channel && p.channel.group === g);
    const st = new Map();
    let peerDev = null,
      peerGroup = null;
    for (const m of members) {
      let s = 'D';
      if (!m.shutdown && linkUp(d, m)) {
        const pi = m.peer.iface,
          pd = m.peer.dev;
        const ppo = pi.channel ? pd.ifaces['Port-channel' + pi.channel.group] : null;
        if (po && !sameL2(m, po)) s = 's';
        else if (pd.type === 'switch' && pi.channel && chCompatible(m.channel.mode, pi.channel.mode) && (!ppo || sameL2(pi, ppo))) {
          if (peerDev === null) {
            peerDev = pd;
            peerGroup = pi.channel.group;
          }
          s = pd === peerDev && pi.channel.group === peerGroup ? 'P' : 'I';
        } else s = 'I';
      }
      st.set(m, s);
    }
    const bundled = members.filter((m) => st.get(m) === 'P');
    const mode0 = members.length ? members[0].channel.mode : 'on';
    const proto = mode0 === 'on' ? '-' : LACP.includes(mode0) ? 'LACP' : 'PAgP';
    return { po, members, st, bundled, proto };
  }
  function bundleOf(d, p) {
    if (d.type !== 'switch' || !p.channel) return null;
    const info = channelInfo(d, p.channel.group);
    if (info.st.get(p) !== 'P') return null;
    return { name: 'Port-channel' + p.channel.group, primary: info.bundled[0] === p, info };
  }
  /** 論理ポート一覧 (束ねられたポートは Port-channel 1 本として扱う) */
  function logicalPorts(d) {
    const out = [];
    const seen = new Set();
    for (const p of physPorts(d)) {
      const b = bundleOf(d, p);
      if (b) {
        if (seen.has(b.name)) continue;
        seen.add(b.name);
        out.push({ name: b.name, rep: p, po: true });
      } else out.push({ name: p.name, rep: p, po: false });
    }
    return out;
  }

  // ------------------------------------------------------------ STP (PVST)
  function carries(sw, p, v) {
    return opMode(sw, p) === 'access' ? p.accessVlan === v : trunkAllows(p, v);
  }
  function portNum(name) {
    const n = Number(name.split(/[/l]/).pop());
    if (name.startsWith('Port-channel')) return 64 + Number(name.slice(12));
    return name.startsWith('Gigabit') ? 24 + n : n;
  }
  function bridgeMac(sw) {
    return sw.bmac || macOf(sw, sw.ifaces.Vlan1);
  }
  function bridgePrio(sw, v) {
    const p = sw.stp.prio.get(v);
    return (p == null ? 32768 : p) + v;
  }
  const cmpBid = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  function cmpVec(a, b) {
    return cmpBid(a.root, b.root) || a.cost - b.cost || cmpBid(a.sbid, b.sbid) || a.spid - b.spid || a.ppid - b.ppid;
  }
  function computeStp(net, v) {
    const c = cache(net);
    if (c.stp[v]) return c.stp[v];
    const info = {};
    const sws = Object.values(net.devices).filter((d) => d.type === 'switch' && d.vlans.has(v));
    for (const sw of sws) {
      const bid = [bridgePrio(sw, v), bridgeMac(sw)];
      const ports = [];
      for (const lp of logicalPorts(sw)) {
        const p = lp.rep;
        if (!linkUp(sw, p) || !carries(sw, p, v)) continue;
        const name = lp.name;
        const cost = lp.po ? 3 : p.name.startsWith('Gigabit') ? 4 : 19;
        let peer = null;
        const pd = p.peer.dev,
          pi = p.peer.iface;
        if (pd.type === 'switch' && pd.vlans.has(v) && carries(pd, pi, v)) {
          const pb = bundleOf(pd, pi);
          peer = { id: pd.id, name: pb ? pb.name : pi.name };
        }
        ports.push({ name, rep: p, cost, pid: portNum(name), peer, edge: p.portfast });
      }
      info[sw.id] = { sw, bid, ports, best: { root: bid, cost: 0, sbid: bid, spid: 0, ppid: 0 }, rootPort: null };
    }
    for (let it = 0; it < sws.length + 2; it++) {
      for (const id in info) {
        const I = info[id];
        let best = { root: I.bid, cost: 0, sbid: I.bid, spid: 0, ppid: 0 },
          rp = null;
        for (const pt of I.ports) {
          if (!pt.peer) continue;
          const N = info[pt.peer.id];
          const np = N.ports.find((x) => x.name === pt.peer.name);
          if (!np) continue;
          const cand = { root: N.best.root, cost: N.best.cost + pt.cost, sbid: N.bid, spid: np.pid, ppid: pt.pid };
          if (cmpBid(cand.root, I.bid) < 0 && (rp === null ? true : cmpVec(cand, best) < 0)) {
            best = cand;
            rp = pt;
          }
        }
        I.best = best;
        I.rootPort = rp;
      }
    }
    for (const id in info) {
      const I = info[id];
      for (const pt of I.ports) {
        if (pt === I.rootPort) pt.role = 'Root';
        else if (!pt.peer) pt.role = 'Desg';
        else {
          const N = info[pt.peer.id];
          const np = N.ports.find((x) => x.name === pt.peer.name);
          const mine = { root: I.best.root, cost: I.best.cost, sbid: I.bid, spid: pt.pid, ppid: 0 };
          const his = { root: N.best.root, cost: N.best.cost, sbid: N.bid, spid: np ? np.pid : 0, ppid: 0 };
          pt.role = cmpVec(mine, his) < 0 ? 'Desg' : 'Altn';
        }
      }
    }
    c.stp[v] = info;
    return info;
  }
  function stpRole(net, sw, p, v) {
    if (sw.type !== 'switch') return 'Desg';
    const I = computeStp(net, v)[sw.id];
    if (!I) return 'Desg';
    const b = bundleOf(sw, p);
    const name = b ? b.name : p.name;
    const pt = I.ports.find((x) => x.name === name);
    return pt ? pt.role : 'Desg';
  }
  /** ポートがいずれかの VLAN でブロックされているか (トポロジ表示用) */
  function portBlocked(net, sw, p) {
    if (sw.type !== 'switch' || !linkUp(sw, p)) return false;
    const vl = opMode(sw, p) === 'access' ? [p.accessVlan] : [...sw.vlans.keys()].filter((v) => trunkAllows(p, v));
    return vl.some((v) => stpRole(net, sw, p, v) === 'Altn');
  }

  // ------------------------------------------------------------ IPv6
  function ip6Parse(s) {
    if (typeof s !== 'string' || s.indexOf(':') < 0 || !/^[0-9a-fA-F:]+$/.test(s)) return null;
    const dbl = s.split('::');
    if (dbl.length > 2) return null;
    const part = (x) => (x === '' ? [] : x.split(':'));
    const a = part(dbl[0]),
      b = dbl.length === 2 ? part(dbl[1]) : [];
    if (dbl.length === 1 && a.length !== 8) return null;
    if (dbl.length === 2 && a.length + b.length > 7) return null;
    const groups = dbl.length === 2 ? a.concat(Array(8 - a.length - b.length).fill('0'), b) : a;
    let n = 0n;
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      n = (n << 16n) | BigInt(parseInt(g, 16));
    }
    return n;
  }
  function ip6Str(n) {
    if (n === null || n === undefined) return 'unassigned';
    const g = [];
    for (let k = 7; k >= 0; k--) g.push(Number((n >> BigInt(16 * k)) & 0xffffn));
    let bs = -1,
      bl = 0;
    for (let i = 0; i < 8; ) {
      if (g[i] === 0) {
        let j = i;
        while (j < 8 && g[j] === 0) j++;
        if (j - i > bl && j - i >= 2) {
          bs = i;
          bl = j - i;
        }
        i = j;
      } else i++;
    }
    const hex = (x) => x.toString(16).toUpperCase();
    if (bs < 0) return g.map(hex).join(':');
    return g.slice(0, bs).map(hex).join(':') + '::' + g.slice(bs + bl).map(hex).join(':');
  }
  const mask6 = (p) => (p === 0 ? 0n : ((1n << BigInt(p)) - 1n) << BigInt(128 - p));
  const in6 = (a, net, p) => ((a ^ net) & mask6(p)) === 0n;
  function parsePfx6(s) {
    const m = String(s).match(/^(.+)\/(\d{1,3})$/);
    if (!m) return null;
    const a = ip6Parse(m[1]),
      p = Number(m[2]);
    if (a === null || p > 128) return null;
    return { addr: a, plen: p };
  }
  function eui64(d, i) {
    const mac = macOf(d, i).replace(/\./g, '');
    const b0 = (parseInt(mac.slice(0, 2), 16) ^ 0x02).toString(16).padStart(2, '0');
    return BigInt('0x' + b0 + mac.slice(2, 6) + 'fffe' + mac.slice(6));
  }
  const LL_PREFIX = 0xfe80n << 112n;
  const isLL = (a) => a >> 118n === 0x3fan;
  function hasV6(d, i) {
    return isHost(d) ? !!(i.ip6 || d.gateway6 != null || d.v6on) : !!(i.ip6 || i.v6en);
  }
  function linkLocal(d, i) {
    return LL_PREFIX | eui64(d, i);
  }
  function up6(d, i) {
    return (isHost(d) ? linkUp(d, i) : ifUp(d, i)) && hasV6(d, i);
  }
  function routingTable6(net, d) {
    const c = cache(net);
    if (c.rt6[d.id]) return c.rt6[d.id];
    const cands = [];
    for (const i of sortedIfaces(d)) {
      if (!i.ip6 || !ifUp(d, i)) continue;
      cands.push({ code: 'C', net: i.ip6.addr & mask6(i.ip6.plen), plen: i.ip6.plen, ad: 0, via: [{ ip: null, iface: i }] });
      cands.push({ code: 'L', net: i.ip6.addr, plen: 128, ad: 0, via: [{ ip: null, iface: i }] });
    }
    for (const r of d.staticRoutes6) {
      let ok;
      if (r.iface) {
        const i = d.ifaces[r.iface];
        ok = !!i && ifUp(d, i);
      } else ok = cands.some((e) => e.code === 'C' && in6(r.nh, e.net, e.plen));
      if (ok) cands.push({ code: 'S', net: r.net, plen: r.plen, ad: r.ad, via: [{ ip: r.nh, iface: r.iface ? d.ifaces[r.iface] : null }] });
    }
    const best = new Map();
    for (const e of cands) {
      const k = e.net.toString() + '/' + e.plen + e.code[0];
      const kk = e.code === 'L' ? k : e.net.toString() + '/' + e.plen;
      const cur = best.get(kk);
      if (!cur || e.ad < cur.ad) best.set(kk, e);
    }
    const rt = [...best.values()].sort((a, b) => (a.net < b.net ? -1 : a.net > b.net ? 1 : a.plen - b.plen));
    c.rt6[d.id] = rt;
    return rt;
  }
  function lpm6(rt, dst) {
    let best = null;
    for (const e of rt) if (e.code !== 'L' && in6(dst, e.net, e.plen) && (!best || e.plen > best.plen)) best = e;
    return best;
  }
  function routeLookup6(net, d, dst) {
    if (d.type !== 'router') {
      const i = d.ifaces.FastEthernet0;
      if (!i || !linkUp(d, i) || !hasV6(d, i)) return null;
      if (isLL(dst) || (i.ip6 && in6(dst, i.ip6.addr, i.ip6.plen))) return { iface: i, nh: dst };
      if (d.gateway6 != null) return { iface: i, nh: d.gateway6 };
      return null;
    }
    const rt = routingTable6(net, d);
    const e = lpm6(rt, dst);
    if (!e) return null;
    const v = e.via[0];
    if (v.iface) return { iface: v.iface, nh: v.ip != null ? v.ip : dst };
    const e2 = lpm6(rt, v.ip);
    if (!e2 || !e2.via[0].iface) return null;
    return { iface: e2.via[0].iface, nh: v.ip };
  }
  function owns6(d, a) {
    for (const i of Object.values(d.ifaces)) {
      if (!up6(d, i)) continue;
      if ((i.ip6 && i.ip6.addr === a) || linkLocal(d, i) === a) return true;
    }
    return false;
  }
  function sendPacket6(net, ctx, origin, pkt) {
    let d = origin,
      inIf = null;
    const hops = [],
      path = [origin.id];
    const fail = (reason, dev, extra) => Object.assign({ ok: false, reason, dev, hops, path, pkt }, extra || {});
    for (let step = 0; step < 40; step++) {
      if (owns6(d, pkt.dst)) return { ok: true, dev: d, hops, path, pkt };
      if (inIf && (d.type !== 'router' || !d.ipv6Routing)) return fail('drop', d);
      if (inIf && --pkt.ttl <= 0) return fail('ttl', d);
      const r = routeLookup6(net, d, pkt.dst);
      if (!r || !up6(d, r.iface)) return fail(inIf ? 'unreach' : 'noroute', d, { replyIp: inIf && inIf.ip6 ? inIf.ip6.addr : null });
      if (pkt.src == null) pkt.src = isLL(r.nh) && !r.iface.ip6 ? linkLocal(d, r.iface) : r.iface.ip6 ? r.iface.ip6.addr : linkLocal(d, r.iface);
      if (pkt.origSrc == null) pkt.origSrc = pkt.src;
      const ep = l2Domain(net, d, r.iface).find(
        (e) => e.dev !== d && up6(e.dev, e.iface) && ((e.iface.ip6 && e.iface.ip6.addr === r.nh) || linkLocal(e.dev, e.iface) === r.nh)
      );
      if (!ep) return fail('arp', d);
      hops.push({ dev: ep.dev, iface: ep.iface, src: pkt.src });
      for (const id of ep.path.slice(1)) path.push(id);
      d = ep.dev;
      inIf = ep.iface;
    }
    return fail('loop', d);
  }
  function slaac(net, pc) {
    const nic = pc.ifaces.FastEthernet0;
    pc.v6on = true;
    nic.ip6 = null;
    pc.gateway6 = null;
    touch(net);
    if (!linkUp(pc, nic)) return { ok: false };
    for (const ep of l2Domain(net, pc, nic)) {
      const r = ep.dev,
        i = ep.iface;
      if (r.type !== 'router' || !r.ipv6Routing || !i.ip6 || i.ip6.plen !== 64 || !ifUp(r, i)) continue;
      nic.ip6 = { addr: (i.ip6.addr & mask6(64)) | eui64(pc, nic), plen: 64, auto: true };
      pc.gateway6 = linkLocal(r, i);
      touch(net);
      return { ok: true, router: r };
    }
    return { ok: false };
  }
  NC.ip6 = { ip6Parse, ip6Str, mask6, in6, parsePfx6, linkLocal, isLL, eui64 };

  // ------------------------------------------------------------ misc
  function macOf(d, i) {
    let h = 2166136261;
    const s = d.id + '/' + i.name;
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
    const hex = (h >>> 0).toString(16).padStart(8, '0');
    const p = (d.type === 'router' ? '00d0' : d.type === 'switch' ? '0001' : '0060') + hex;
    return p.slice(0, 4) + '.' + p.slice(4, 8) + '.' + p.slice(8, 12);
  }

  Object.assign(NC, {
    newIface,
    makeDevice,
    resetConfig,
    addIface,
    sortedIfaces,
    physPorts,
    subIfacesOf,
    isHost,
    wire,
    buildNet,
    rebootDevice,
    touch,
    linkUp,
    opMode,
    trunkAllows,
    ifUp,
    ifStatus,
    l2Domain,
    computeOspf,
    routerId,
    ospfIfaces,
    routingTable,
    routeLookup,
    ownsIp,
    aclEval,
    sendPacket,
    ping,
    trace,
    dhcpRequest,
    dhcpRetry,
    macOf,
    channelInfo,
    bundleOf,
    logicalPorts,
    computeStp,
    stpRole,
    portBlocked,
    bridgeMac,
    bridgePrio,
    routingTable6,
    sendPacket6,
    slaac,
    up6,
    hasV6,
  });
})(typeof window !== 'undefined' ? window : globalThis);
