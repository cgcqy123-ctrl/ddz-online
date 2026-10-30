// 界面渲染与交互（只负责 DOM，不含规则和网络）

const V = new URL(import.meta.url).search; // 跟随 index.html 的 ?v= 做缓存穿透
const { findHints, RANK_LABEL } = await import('./rules.js' + V);

const $ = (id) => document.getElementById(id);

let lastView = null;
let onAction = null;
let sel = new Set();
let handSig = '';
let hints = [];
let hintIdx = 0;
let toastTimer = 0;

/* ---------- 基础 ---------- */

export function showScreen(name) {
  for (const id of ['home', 'lobby', 'table']) {
    $('scr-' + id).classList.toggle('hidden', id !== name);
  }
}

export function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function cardEl(card, { small = false } = {}) {
  const d = document.createElement('div');
  const isJoker = card.r >= 16;
  const red = card.s === '♥' || card.s === '♦' || card.r === 17;
  d.className = 'card' + (small ? ' small' : '') + (isJoker ? ' joker' : '') + (red ? ' red' : '');
  d.dataset.id = card.id;
  if (isJoker) {
    d.innerHTML = `<span class="r">${card.r === 17 ? '大' : '小'}</span><span class="s">王</span>`;
  } else {
    d.innerHTML = `<span class="r">${RANK_LABEL[card.r]}</span><span class="s">${card.s}</span>`;
  }
  return d;
}

function backEl(small = false) {
  const d = document.createElement('div');
  d.className = 'card back' + (small ? ' small' : '');
  d.innerHTML = '<span>🂠</span>';
  return d;
}

/**
 * 出牌展示行：kind = 'opp'（对手，稍小）| 'me'（自己，更大更靠前）
 * 尺寸在挂到 DOM 之后用 fitPlayRow 依据容器宽度和牌数算出来，保证一行放得下
 */
function playRow(cards, kind) {
  const wrap = document.createElement('div');
  wrap.className = 'play-row ' + kind;
  for (const c of cards) wrap.appendChild(cardEl(c));
  return wrap;
}

function fitPlayRow(row, count, kind) {
  const vw = Math.min(window.innerWidth || 390, 620);
  const cw =
    kind === 'me'
      ? Math.round(Math.max(36, Math.min(54, vw * 0.12)))
      : Math.round(Math.max(30, Math.min(42, vw * 0.094)));
  const box = row.parentElement;
  const measured = box ? box.clientWidth : 0;
  const avail = Math.max(cw, measured ? measured - 10 : kind === 'me' ? vw - 24 : vw * 0.44);
  const step = count > 1 ? Math.min(cw - 4, Math.max(10, (avail - cw) / (count - 1))) : cw;
  row.style.setProperty('--cw', cw + 'px');
  row.style.setProperty('--step', step + 'px');
}

/* ---------- 房间大厅 ---------- */

export function renderLobby({ code, seats, isHost, canStart, tip }) {
  showScreen('lobby');
  $('lobby-code').textContent = code || '----';
  const ul = $('seat-list');
  ul.innerHTML = '';
  seats.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'seat-item' + (s.name ? ' filled' : '');
    const role = i === 0 ? '房主' : '玩家 ' + (i + 1);
    li.innerHTML = `
      <span class="idx">${i + 1}</span>
      <span class="nm">${s.name ? escapeHtml(s.name) : '空位'}</span>
      <span class="tag">${role}</span>`;
    ul.appendChild(li);
  });
  const btn = $('btn-start');
  btn.classList.toggle('hidden', !isHost);
  btn.disabled = !canStart;
  btn.textContent = canStart ? '开始游戏' : `等待玩家入座 (${seats.filter((s) => s.name).length}/3)`;
  $('lobby-tip').textContent = tip || (isHost ? '把房号发给朋友，满 3 人后点「开始游戏」' : '等待房主开始游戏…');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 牌桌 ---------- */

export function renderTable(view, actionCb) {
  const first = lastView === null || lastView.round !== view.round;
  lastView = view;
  onAction = actionCb;
  showScreen('table');

  const sig = view.hand.map((c) => c.id).join(',');
  if (sig !== handSig) {
    handSig = sig;
    sel.clear();
    hints = [];
    hintIdx = 0;
  }

  $('t-code').textContent = view._code || $('t-code').textContent;
  $('t-base').textContent = view.phase === 'bid' ? '-' : view.baseScore;
  $('t-mult').textContent = 'x' + view.multiplier;

  // 底牌
  const bc = $('t-bottom');
  bc.innerHTML = '';
  if (view.phase === 'bid') {
    for (let i = 0; i < 3; i++) bc.appendChild(backEl(true));
  } else {
    for (const c of view.bottom) bc.appendChild(cardEl(c, { small: true }));
  }

  const selfSeat = view.seat;
  const rightSeat = (selfSeat + 1) % 3; // 下家
  const leftSeat = (selfSeat + 2) % 3; // 上家
  renderSeatPanel($('seat-right'), view, rightSeat);
  renderSeatPanel($('seat-left'), view, leftSeat);

  // 我的最近一手（正前方，牌更大）
  const myPlay = $('my-play');
  myPlay.innerHTML = '';
  const rec = view.recent[selfSeat];
  if (rec && rec.kind === 'play') {
    const row = playRow(rec.cards, 'me');
    myPlay.appendChild(row);
    fitPlayRow(row, rec.cards.length, 'me');
  } else if (rec && rec.kind === 'pass') {
    myPlay.innerHTML = '<span class="pass-tag">不出</span>';
  }

  // 自己的信息栏
  const mine = view.seats[selfSeat];
  const myBid = view.bids[selfSeat];
  const myRole =
    view.landlord === selfSeat
      ? '<span class="role landlord">地主</span>'
      : view.landlord >= 0
        ? '<span class="role farmer">农民</span>'
        : '';
  const myBidTag =
    view.phase === 'bid' && myBid !== null && myBid !== undefined
      ? `<span class="bid-tag">${myBid ? myBid + '分' : '不叫'}</span>`
      : '';
  $('my-info').innerHTML = `
    <span class="nm">${escapeHtml(mine.name)}</span>${myRole}${myBidTag}
    <span class="cnt">手牌 ${mine.count} 张</span>`;
  $('myarea').classList.toggle('active', view.turn === selfSeat && view.phase !== 'over');

  renderHand(view);
  renderActions(view);

  if (view.phase === 'over' && view.result) renderResult(view);
  else $('overlay').classList.add('hidden');

  if (first) hintIdx = 0;
}

function renderSeatPanel(root, view, seat) {
  const s = view.seats[seat];
  const isTurn = view.turn === seat && (view.phase === 'bid' || view.phase === 'play');
  const isLandlord = view.landlord === seat;
  const bid = view.bids[seat];
  const rec = view.recent[seat];
  root.innerHTML = '';
  root.classList.toggle('active', isTurn);

  const head = document.createElement('div');
  head.className = 'p-head';
  const roleTag = isLandlord
    ? '<span class="role landlord">地主</span>'
    : view.landlord >= 0
      ? '<span class="role farmer">农民</span>'
      : '';
  const bidTag =
    view.phase === 'bid' && bid !== null && bid !== undefined
      ? `<span class="bid-tag">${bid ? bid + '分' : '不叫'}</span>`
      : '';
  head.innerHTML = `
    <span class="nm">${escapeHtml(s.name)}${s.connected ? '' : ' <i class="off">离线</i>'}</span>
    ${roleTag}${bidTag}
    <span class="cnt">剩 ${s.count} 张</span>`;
  root.appendChild(head);

  const zone = document.createElement('div');
  zone.className = 'p-play';
  root.appendChild(zone);
  if (rec && rec.kind === 'play') {
    const row = playRow(rec.cards, 'opp');
    zone.appendChild(row);
    fitPlayRow(row, rec.cards.length, 'opp');
  } else if (rec && rec.kind === 'pass') {
    zone.innerHTML = '<span class="pass-tag">不出</span>';
  }
}

function renderHand(view) {
  const hand = $('hand');
  hand.innerHTML = '';
  const canAct = view.turn === view.seat && view.phase === 'play';
  const n = view.hand.length;
  // 手牌越多，牌越小、重叠越多，保证一行放得下
  const vw = Math.min(window.innerWidth || 390, 620);
  const cw = Math.round(Math.max(30, Math.min(52, vw * 0.125)));
  const avail = vw - 30;
  const step = n > 1 ? Math.min(cw - 3, Math.max(12, (avail - cw) / (n - 1))) : cw;
  hand.style.setProperty('--cw', cw + 'px');
  hand.style.setProperty('--step', step + 'px');
  for (const c of view.hand) {
    const el = cardEl(c);
    if (sel.has(c.id)) el.classList.add('selected');
    if (!canAct) el.classList.add('locked');
    el.addEventListener('click', () => {
      if (!(view.turn === view.seat && view.phase === 'play')) {
        toast('还没轮到你');
        return;
      }
      if (sel.has(c.id)) {
        sel.delete(c.id);
        el.classList.remove('selected');
      } else {
        sel.add(c.id);
        el.classList.add('selected');
      }
      updatePlayBtn(view);
    });
    hand.appendChild(el);
  }
}

function renderActions(view) {
  const bar = $('actions');
  bar.innerHTML = '';
  const mine = view.turn === view.seat;

  if (view.phase === 'bid') {
    if (!mine) {
      bar.innerHTML = `<span class="wait">等待 ${escapeHtml(view.seats[view.turn].name)} 叫分…</span>`;
      return;
    }
    bar.appendChild(btn('不叫', 'ghost', () => onAction({ type: 'bid', value: 0 })));
    for (const v of [1, 2, 3]) {
      const b = btn(v + ' 分', v === 3 ? 'primary' : 'normal', () => onAction({ type: 'bid', value: v }));
      if (v <= view.bidHigh) b.disabled = true;
      bar.appendChild(b);
    }
    return;
  }

  if (view.phase === 'play') {
    if (!mine) {
      bar.innerHTML = `<span class="wait">等待 ${escapeHtml(view.seats[view.turn].name)} 出牌…</span>`;
      return;
    }
    bar.appendChild(btn('提示', 'ghost', () => doHint(view)));
    const pass = btn('不出', 'ghost', () => onAction({ type: 'pass' }));
    if (!view.lastPlay) pass.disabled = true;
    bar.appendChild(pass);
    const play = btn('出牌', 'primary', () => {
      if (!sel.size) {
        toast('先选牌');
        return;
      }
      onAction({ type: 'play', cards: [...sel] });
    });
    play.id = 'btn-play';
    bar.appendChild(play);
    updatePlayBtn(view);
    return;
  }

  if (view.phase === 'over') {
    bar.innerHTML = '<span class="wait">本局结束</span>';
  }
}

function updatePlayBtn(view) {
  const b = $('btn-play');
  if (!b) return;
  b.textContent = sel.size ? `出牌 (${sel.size})` : '出牌';
}

function btn(text, kind, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + kind;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

function doHint(view) {
  if (!hints.length) {
    hints = findHints(view.hand, view.lastPlay ? view.lastPlay.combo : null);
    hintIdx = 0;
  }
  if (!hints.length) {
    toast(view.lastPlay ? '没有能压过的牌，只能不出' : '没有可出的牌');
    return;
  }
  const c = hints[hintIdx % hints.length];
  hintIdx++;
  sel = new Set(c.cards.map((x) => x.id));
  for (const el of $('hand').children) {
    el.classList.toggle('selected', sel.has(el.dataset.id));
  }
  updatePlayBtn(view);
}

function renderResult(view) {
  const ov = $('overlay');
  const p = $('overlay-panel');
  const r = view.result;
  const win = r.landlordWin ? '地主获胜' : '农民获胜';
  const myDelta = r.deltas[view.seat];
  p.innerHTML = `
    <h2 class="${r.landlordWin ? 'wl' : 'wf'}">${win}${r.spring ? ' · 春天' : ''}</h2>
    <p class="calc">底分 ${view.baseScore} × 倍数 ${view.multiplier} = <b>${r.score}</b> 分</p>
    <ul class="score-list">
      ${view.seats
        .map(
          (s) =>
            `<li class="${r.deltas[s.seat] > 0 ? 'up' : 'down'}">
               <span>${escapeHtml(s.name)}${s.seat === r.landlord ? '（地主）' : ''}</span>
               <b>${r.deltas[s.seat] > 0 ? '+' : ''}${r.deltas[s.seat]}</b>
             </li>`
        )
        .join('')}
    </ul>
    <p class="mine ${myDelta >= 0 ? 'up' : 'down'}">你 ${myDelta > 0 ? '+' : ''}${myDelta} 分</p>
    <div class="ov-actions"></div>`;
  const acts = p.querySelector('.ov-actions');
  if (view._isHost) {
    acts.appendChild(btn('再来一局', 'primary', () => onAction({ type: 'restart' })));
  } else {
    const span = document.createElement('span');
    span.className = 'wait';
    span.textContent = '等待房主开下一局…';
    acts.appendChild(span);
  }
  ov.classList.remove('hidden');
}

export function clearOverlay() {
  $('overlay').classList.add('hidden');
}

export function resetSelection() {
  sel.clear();
  hints = [];
  hintIdx = 0;
}
