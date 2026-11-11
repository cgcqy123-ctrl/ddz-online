// 端到端冒烟测试（需要 jsdom）：在 jsdom 里真跑 main.js，用假 Peer 模拟两位好友
// 覆盖：建房 → 入座 → 开局 → 打完一局 → 再来一局 → 掉线重连 → 满员拒绝
// 运行：npm install && npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'https://example.com/',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;

/* ---------------- 假 PeerJS ---------------- */
const registry = new Map();
let connSeq = 0;

class FakeConn {
  constructor(remoteId) {
    this.id = 'c' + ++connSeq;
    this.peer = remoteId;
    this.open = false;
    this.h = {};
    this.remote = null;
    this.closed = false;
  }
  on(ev, cb) { (this.h[ev] = this.h[ev] || []).push(cb); return this; }
  emit(ev, arg) { for (const cb of this.h[ev] || []) cb(arg); }
  send(msg) {
    if (!this.open) throw new Error('conn is not open');
    const copy = JSON.parse(JSON.stringify(msg));
    const other = this.remote;
    if (other) setTimeout(() => other.emit('data', copy), 0);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    const other = this.remote;
    if (other && !other.closed) setTimeout(() => other.emit('close'), 0);
  }
  _open() { this.open = true; this.emit('open'); }
}

class FakePeer {
  constructor(id) {
    this.id = id || 'auto-' + Math.random().toString(36).slice(2, 8);
    this.h = {};
    if (registry.has(this.id)) {
      setTimeout(() => this.emit('error', { type: 'unavailable-id' }), 0);
      return;
    }
    registry.set(this.id, this);
    setTimeout(() => this.emit('open', this.id), 0);
  }
  on(ev, cb) { (this.h[ev] = this.h[ev] || []).push(cb); return this; }
  emit(ev, arg) { for (const cb of this.h[ev] || []) cb(arg); }
  connect(remoteId) {
    const a = new FakeConn(remoteId);
    const target = registry.get(remoteId);
    if (!target) {
      setTimeout(() => this.emit('error', { type: 'peer-unavailable' }), 0);
      return a;
    }
    const b = new FakeConn(this.id);
    a.remote = b;
    b.remote = a;
    setTimeout(() => {
      // 真实 PeerJS 的顺序：房主先拿到连接对象并注册回调，两边 open 之后才开始传数据
      target.emit('connection', b);
      b._open();
      a._open();
    }, 0);
    return a;
  }
  destroy() { registry.delete(this.id); }
}

global.Peer = FakePeer;
dom.window.Peer = FakePeer;

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** 轮询等待条件成立（跨网络/重试类断言不要用固定 tick） */
async function waitFor(fn, timeout = 4000, step = 20) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await tick(step);
  }
  return false;
}
const PROBLEMS = [];
const ok = (c, m) => { if (!c) PROBLEMS.push(m); };
const $ = (id) => document.getElementById(id);
const clickText = (root, text) => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent.includes(text));
  if (b && !b.disabled) { b.click(); return true; }
  return false;
};

/* ---------------- 载入 main.js ---------------- */
await import(url('js/main.js'));
const rules = await import(url('js/rules.js'));
await tick(10);
ok(!$('scr-home').classList.contains('hidden'), '启动后停在首页');

/* ---------------- 房主建房 ---------------- */
$('in-name').value = '甲';
$('btn-create').click();
await tick(20);
ok(!$('scr-lobby').classList.contains('hidden'), '建房后进入房间页');
const code = $('lobby-code').textContent.trim();
ok(/^[A-Z0-9]{4}$/.test(code), '房号是 4 位，实际：' + code);
const hostId = 'ddzcard-' + code.toLowerCase();
ok(registry.has(hostId), '房主已注册信令 id');
ok($('btn-start').disabled, '1 人时不能开始');

/* ---------------- 两位好友加入 ---------------- */
function joinAs(name) {
  const peer = new FakePeer();
  const conn = peer.connect(hostId);
  const box = { name, peer, conn, seat: null, states: 0, toasts: [], lobbys: [] };
  conn.on('data', (msg) => {
    if (msg.t === 'joined') box.seat = msg.seat;
    else if (msg.t === 'state') { box.states++; autoAct(box, msg.view); }
    else if (msg.t === 'toast') box.toasts.push(msg.msg);
    else if (msg.t === 'lobby') box.lobbys.push(msg);
  });
  conn.on('open', () => conn.send({ t: 'hello', name }));
  return box;
}

// 模拟真人：轮到自己就用「提示」里的第一手
function autoAct(box, view) {
  if (view.phase !== 'bid' && view.phase !== 'play') return;
  if (view.turn !== view.seat) return;
  setTimeout(() => {
    if (view.phase === 'bid') {
      const v = Math.min(3, view.bidHigh + 1);
      const strong = view.hand.filter((c) => c.r >= 15).length >= 3;
      box.conn.send({ t: 'action', a: { type: 'bid', value: strong ? v : 0 } });
      return;
    }
    const last = view.lastPlay ? view.lastPlay.combo : null;
    const hints = rules.findHints(view.hand, last);
    if (hints.length) {
      box.conn.send({ t: 'action', a: { type: 'play', cards: hints[0].cards.map((c) => c.id) } });
    } else {
      box.conn.send({ t: 'action', a: { type: 'pass' } });
    }
  }, 0);
}

const g1 = joinAs('乙');
await waitFor(() => g1.seat === 1);
await tick(40);

// 大厅同步回归：第一位客人应该立刻能收到「房主 + 自己」的座位列表
const g1Lobby1 = g1.lobbys[g1.lobbys.length - 1];
ok(!!g1Lobby1, '客人收到大厅座位同步');
ok(g1Lobby1 && g1Lobby1.seats[0] && g1Lobby1.seats[0].name === '甲', '客人能看到房主名字');
ok(g1Lobby1 && g1Lobby1.seats[1] && g1Lobby1.seats[1].name === '乙', '客人能看到自己的座位');

const g2 = joinAs('丙');
await waitFor(() => g2.seat === 2);
await tick(60);

ok(g1.seat === 1, '乙 应该坐 1 号位，实际 ' + g1.seat);
ok(g2.seat === 2, '丙 应该坐 2 号位，实际 ' + g2.seat);
ok($('btn-start').disabled === false, '3 人齐后可以开始');
ok(document.querySelectorAll('#seat-list .seat-item.filled').length === 3, '大厅显示 3 个座位');
ok(/已入座 3\/3/.test($('lobby-count').textContent), '房主看到人数 3/3，实际：' + $('lobby-count').textContent);

// 第二位客人入座后，第一位客人也要收到更新后的 3 人座位表
const g1Lobby2 = g1.lobbys[g1.lobbys.length - 1];
ok(g1Lobby2 && g1Lobby2.seats.filter((s) => s.name).length === 3, '第一位客人能看到 3 人已入座');
const g2Lobby = g2.lobbys[g2.lobbys.length - 1];
ok(g2Lobby && g2Lobby.seats[0].name === '甲' && g2Lobby.seats[2].name === '丙', '第二位客人能看到房主和全部座位');

// 重复 hello 幂等：Safari 补发 hello 时不能抢到别人座位，还要补发大厅
const lobbysBefore = g2.lobbys.length;
g2.conn.send({ t: 'hello', name: '丙' });
await tick(80);
ok(g2.seat === 2, '重复 hello 不会改变座位');
ok(g2.lobbys.length > lobbysBefore, '重复 hello 会补发大厅座位表');

/* ---------------- 开局并打完一局 ---------------- */
$('btn-start').click();
await tick(40);
ok(!$('scr-table').classList.contains('hidden'), '开局后进入牌桌');
ok(document.querySelectorAll('#hand .card').length === 17, '房主先拿 17 张牌');

let steps = 0;
let hostActs = 0;
while (steps++ < 800) {
  if (!$('overlay').classList.contains('hidden')) break;
  const acts = $('actions');
  if (acts.querySelectorAll('button').length) {
    hostActs++;
    if (clickText(acts, '3 分')) {
      /* 叫 3 分直接当地主 */
    } else if (clickText(acts, '提示')) {
      await tick(0);
      if (document.querySelectorAll('#hand .card.selected').length) clickText(acts, '出牌');
      else clickText(acts, '不出');
    } else {
      clickText(acts, '不叫');
    }
  }
  await tick(4);
}
ok(steps < 800, '对局应该在合理步数内结束（步数 ' + steps + '）');
ok(!$('overlay').classList.contains('hidden'), '结束后出现结算浮层');
ok(/地主获胜|农民获胜/.test($('overlay-panel').textContent), '结算文案正确');
ok(hostActs > 2, '房主确实操作过若干次');
ok(g1.states > 3 && g2.states > 3, '两位好友都收到了对局状态');

/* ---------------- 再来一局 ---------------- */
clickText($('overlay-panel'), '再来一局');
await tick(50);
ok($('overlay').classList.contains('hidden'), '再来一局后浮层关闭');
ok(document.querySelectorAll('#hand .card').length >= 17, '新一局重新发牌');

/* ---------------- 掉线重连 ---------------- */
g2.conn.close();
await tick(30);
const g2back = joinAs('丙');
await tick(50);
ok(g2back.seat === 2, '同名重连应该回到 2 号位，实际 ' + g2back.seat);

/* ---------------- 房间已满 ---------------- */
const extraConn = new FakePeer().connect(hostId);
let extraGot = null;
extraConn.on('data', (m) => { extraGot = m; });
extraConn.on('open', () => extraConn.send({ t: 'hello', name: '丁' }));
await tick(80);
ok(extraGot && extraGot.t === 'full', '第 4 个人应该被拒绝');

/* ---------------- Safari 握手重试（直接测 GuestRoom） ---------------- */
const { GuestRoom } = await import(url('js/net.js'));
const dropHost = new FakePeer('ddzcard-test');
let helloSeen = 0;
dropHost.on('connection', (conn) => {
  conn.on('data', (msg) => {
    if (msg.t === 'hello') {
      helloSeen++;
      if (helloSeen === 1) return; // 模拟 Safari 吞掉第一条 hello
      conn.send({ t: 'joined', seat: 1, code: 'TEST' });
    }
  });
});
const received = [];
const gr = new GuestRoom({ onMessage: (m) => received.push(m) });
await gr.join('TEST', '小八');
ok(await waitFor(() => received.some((m) => m.t === 'joined'), 4000), 'GuestRoom 在首条 hello 丢失后会自动重发并完成握手');
ok(helloSeen >= 2, '房主实际收到了重发的 hello，实际次数 ' + helloSeen);
gr.close();

if (PROBLEMS.length) {
  console.error('❌ 端到端测试失败：\n - ' + PROBLEMS.join('\n - '));
  process.exit(1);
}
console.log(
  `✅ 端到端通过：房号 ${code}｜好友入座(${g1.seat},${g2.seat})｜开局｜打完一局｜再来一局｜掉线重连｜满员拒绝`
);
process.exit(0);
