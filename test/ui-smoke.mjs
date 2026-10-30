// UI 冒烟测试（需要 jsdom）：把整局对局完全通过「点按钮」跑完
// 运行：npm install && npm run test:ui
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

const { Game } = await import(url('js/game.js'));
const UI = await import(url('js/ui.js'));

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

/* --- 首页 / 大厅 --- */
UI.showScreen('home');
ok(!document.getElementById('scr-home').classList.contains('hidden'), '首页应可见');
ok(document.getElementById('scr-table').classList.contains('hidden'), '牌桌应隐藏');

UI.renderLobby({
  code: 'AB12',
  seats: [{ name: '甲' }, { name: '乙' }, { name: null }],
  isHost: true,
  canStart: false,
  tip: '测试',
});
ok(document.getElementById('lobby-code').textContent === 'AB12', '房号显示正确');
ok(document.querySelectorAll('#seat-list li').length === 3, '座位列表 3 项');
ok(document.getElementById('btn-start').disabled === true, '人不满时开始按钮禁用');

/* --- 牌桌：整局模拟 --- */
let pending = null;
const g = new Game([{ name: '甲' }, { name: '乙' }, { name: '丙' }]);
g.startRound();

function render(seat) {
  const v = g.view(seat);
  v._code = 'AB12';
  v._isHost = seat === 0;
  pending = null;
  UI.renderTable(v, (act) => { pending = act; });
  return v;
}
const buttons = () => [...document.querySelectorAll('#actions button')];
function clickByText(t) {
  const b = buttons().find((x) => x.textContent.includes(t));
  ok(!!b, `找不到按钮「${t}」`);
  if (b && !b.disabled) { b.click(); return true; }
  return false;
}

let guard = 0;
let playedCards = 0;
let hinted = 0;
while (g.phase !== 'over') {
  if (guard++ > 3000) throw new Error('模拟卡住了');
  const seat = g.turn;
  const v = render(seat);
  ok(document.querySelectorAll('#hand .card').length === v.hand.length, '手牌数量渲染正确');

  if (g.phase === 'bid') {
    if (!clickByText('3 分')) clickByText('不叫');
  } else {
    clickByText('提示');
    if (document.querySelectorAll('#hand .card.selected').length > 0) {
      hinted++;
      clickByText('出牌');
    }
    if (!pending) clickByText('不出');
    if (!pending) throw new Error('没产生任何动作');
  }
  if (!pending) throw new Error('按钮没有触发动作');
  g.action(seat, pending);
  if (pending.type === 'play') playedCards += pending.cards.length;
}

/* --- 结算 --- */
render(0);
ok(!document.getElementById('overlay').classList.contains('hidden'), '结束后应显示结算浮层');
ok(/地主获胜|农民获胜/.test(document.getElementById('overlay-panel').textContent), '结算文案正确');
ok(document.querySelector('#overlay-panel .ov-actions button') !== null, '房主有「再来一局」按钮');
ok(playedCards > 0 && hinted > 0, '至少提示并出过牌');

/* --- 中途状态：手动选择一张牌 --- */
const g2 = new Game([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
g2.startRound();
g2.action(g2.turn, { type: 'bid', value: 3 });
const v2 = g2.view(g2.landlord);
v2._code = 'ZZ99';
v2._isHost = true;
UI.renderTable(v2, () => {});
const cards = document.querySelectorAll('#hand .card');
ok(cards.length === 20, '地主 20 张牌');
cards[cards.length - 1].click();
ok(document.querySelectorAll('#hand .card.selected').length === 1, '点一张牌应被选中');
cards[cards.length - 1].click();
ok(document.querySelectorAll('#hand .card.selected').length === 0, '再点一次取消选中');
ok(document.getElementById('btn-play').textContent.includes('出牌'), '出牌按钮存在');
ok(document.getElementById('t-base').textContent === '3', '底分显示');
ok(document.querySelectorAll('#t-bottom .card').length === 3, '底牌 3 张');
ok(document.querySelectorAll('#seat-left .p-head, #seat-right .p-head').length === 2, '两个对手面板');

if (problems.length) {
  console.error('❌ UI 冒烟测试失败：\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`✅ UI 冒烟测试通过（模拟 ${guard} 步、出牌 ${playedCards} 张、提示 ${hinted} 次）`);
