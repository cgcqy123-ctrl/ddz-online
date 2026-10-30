// 入口：串起大厅、对局和网络

import { Game, PHASE } from './game.js';
import { HostRoom, GuestRoom, normalizeCode } from './net.js';
import * as UI from './ui.js';

const $ = (id) => document.getElementById(id);

const S = {
  name: '',
  role: null, // 'host' | 'guest'
  seat: 0,
  code: '',
  host: null,
  guest: null,
  game: null,
  lobbySeats: null,
  busy: false,
};

/* ---------- 通用 ---------- */

function getName() {
  const v = $('in-name').value.trim().slice(0, 8);
  if (!v) {
    UI.toast('先填个昵称');
    $('in-name').focus();
    return '';
  }
  localStorage.setItem('ddz-name', v);
  return v;
}

function lock(on) {
  S.busy = on;
  for (const id of ['btn-create', 'btn-join']) $(id).disabled = on;
}

function resetAll() {
  try { S.host && S.host.closeAll(); } catch (_) { /* ignore */ }
  try { S.guest && S.guest.close(); } catch (_) { /* ignore */ }
  S.host = null;
  S.guest = null;
  S.game = null;
  S.role = null;
  S.seat = 0;
  S.code = '';
  UI.clearOverlay();
  UI.resetSelection();
  UI.showScreen('home');
}

/* ---------- 房主 ---------- */

async function createRoom() {
  const name = getName();
  if (!name || S.busy) return;
  lock(true);
  S.role = 'host';
  S.seat = 0;
  S.name = name;
  S.lobbySeats = [
    { name, connected: true },
    { name: null, connected: false },
    { name: null, connected: false },
  ];
  try {
    const room = new HostRoom({
      onHello: hostOnHello,
      onMessage: hostOnMessage,
      onSeatGone: hostOnSeatGone,
      onError: (m) => UI.toast(m),
    });
    S.host = room;
    S.code = await room.open();
    renderLobby();
  } catch (e) {
    UI.toast(e && e.message ? e.message : '创建房间失败');
    resetAll();
  } finally {
    lock(false);
  }
}

function hostOnHello(conn, name) {
  const seats = S.lobbySeats;
  if (!seats) {
    S.host.sendRaw(conn, { t: 'full' });
    return;
  }
  const clean = (name || '').trim().slice(0, 8) || '玩家';
  // 断线重连：同名且标记为离线的座位可以收回
  let seat = seats.findIndex((s, i) => i > 0 && s.name === clean && !s.connected);
  if (seat < 0) seat = seats.findIndex((s, i) => i > 0 && !s.name);
  if (seat < 0) {
    S.host.sendRaw(conn, { t: 'full' });
    setTimeout(() => { try { conn.close(); } catch (_) { /* ignore */ } }, 600);
    return;
  }
  S.host.bind(conn, seat);
  seats[seat] = { name: clean, connected: true };
  if (S.game) S.game.seats[seat].connected = true;
  S.host.send(seat, { t: 'joined', seat, code: S.code });
  UI.toast(`${clean} 加入了房间`);
  if (S.game && S.game.phase !== PHASE.LOBBY) pushStates();
  else renderLobby();
}

function hostOnMessage(seat, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'action') hostAction(seat, msg.a);
}

function hostOnSeatGone(seat) {
  if (!S.lobbySeats || seat <= 0 || !S.lobbySeats[seat]) return;
  const started = !!S.game;
  S.lobbySeats[seat] = { name: started ? S.lobbySeats[seat].name : null, connected: false };
  if (S.game) S.game.seats[seat].connected = false;
  if (started) {
    UI.toast(`${S.game.seats[seat].name} 掉线了，等待重连`);
    pushStates();
  } else {
    renderLobby();
  }
}

function hostAction(seat, act) {
  if (!act || typeof act !== 'object') return;
  if (S.role !== 'host') return;
  if (act.type === 'restart') {
    if (seat !== 0) return;
    startRound();
    return;
  }
  if (!S.game) return;
  try {
    S.game.action(seat, act);
  } catch (e) {
    const msg = e && e.message ? e.message : '操作无效';
    if (seat === 0) UI.toast(msg);
    else if (S.host) S.host.send(seat, { t: 'toast', msg });
    return;
  }
  pushStates();
}

function startRound() {
  if (!S.game) return;
  if (!S.lobbySeats.every((s) => s.name && s.connected)) {
    UI.toast('有玩家掉线，等他回来再开下一局');
    return;
  }
  UI.clearOverlay();
  UI.resetSelection();
  S.game.startRound();
  pushStates();
}

function startGame() {
  if (S.role !== 'host') return;
  if (!S.lobbySeats.every((s) => s.name && s.connected)) {
    UI.toast('要 3 个人都在座位上才能开始');
    return;
  }
  S.game = new Game(S.lobbySeats.map((s) => ({ name: s.name, connected: true })));
  startRound();
}

function renderLobby() {
  if (S.role !== 'host') return;
  const filled = S.lobbySeats.filter((s) => s.name).length;
  UI.renderLobby({
    code: S.code,
    seats: S.lobbySeats,
    isHost: true,
    canStart: filled === 3 && S.lobbySeats.every((s) => s.connected),
    tip: filled < 3 ? `把房号 ${S.code} 发给朋友，满 3 人即可开始` : '人齐了，点「开始游戏」',
  });
}

function pushStates() {
  if (S.role !== 'host' || !S.host) return;
  if (!S.game) return;
  for (let i = 1; i < 3; i++) {
    if (S.lobbySeats[i].name && S.lobbySeats[i].connected) {
      S.host.send(i, { t: 'state', view: S.game.view(i) });
    }
  }
  renderMyTable();
}

function renderMyTable() {
  if (!S.game) return;
  const view = S.game.view(0);
  view._code = S.code;
  view._isHost = true;
  UI.renderTable(view, hostActionLocal);
}

function hostActionLocal(act) {
  hostAction(0, act);
}

/* ---------- 加入者 ---------- */

async function joinRoom() {
  const name = getName();
  if (!name || S.busy) return;
  const code = normalizeCode($('in-code').value);
  if (code.length !== 4) {
    UI.toast('房号是 4 位字母数字');
    return;
  }
  lock(true);
  S.role = 'guest';
  S.name = name;
  S.code = code;
  try {
    const g = new GuestRoom({
      onMessage: guestOnMessage,
      onClose: () => {
        UI.toast('和房主的连接断开了');
        setTimeout(resetAll, 1200);
      },
      onFail: (m) => UI.toast(m),
      onError: (m) => UI.toast(m),
    });
    S.guest = g;
    await g.join(code, name);
    UI.renderLobby({
      code,
      seats: [{ name: '房主' }, { name: '' }, { name: '' }],
      isHost: false,
      canStart: false,
      tip: '正在进入房间…',
    });
  } catch (e) {
    UI.toast(e && e.message ? e.message : '加入失败');
    resetAll();
  } finally {
    lock(false);
  }
}

function guestOnMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'joined':
      S.seat = msg.seat || 0;
      S.code = msg.code || S.code;
      break;
    case 'lobby':
      UI.renderLobby({
        code: msg.code || S.code,
        seats: msg.seats || [],
        isHost: false,
        canStart: false,
        tip: '等待房主开始游戏…',
      });
      break;
    case 'state': {
      const view = msg.view;
      if (!view) return;
      view._code = S.code;
      view._isHost = false;
      UI.renderTable(view, guestActionLocal);
      break;
    }
    case 'toast':
      UI.toast(msg.msg || '');
      break;
    case 'full':
      UI.toast('房间已满（3 人）');
      setTimeout(resetAll, 1500);
      break;
    default:
      break;
  }
}

function guestActionLocal(act) {
  if (!S.guest) return;
  if (!S.guest.send({ t: 'action', a: act })) UI.toast('发送失败，连接可能已断开');
}

/* ---------- 绑定事件 ---------- */

function boot() {
  $('in-name').value = localStorage.getItem('ddz-name') || '';
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('btn-start').addEventListener('click', startGame);
  $('btn-leave').addEventListener('click', () => {
    if (confirm('确定离开房间？')) resetAll();
  });
  $('btn-quit').addEventListener('click', () => {
    if (confirm('确定退出对局？')) resetAll();
  });
  $('in-code').addEventListener('input', (e) => {
    e.target.value = normalizeCode(e.target.value);
  });
  $('in-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('in-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoom();
  });
  window.addEventListener('beforeunload', () => {
    try { S.host && S.host.closeAll(); } catch (_) { /* ignore */ }
    try { S.guest && S.guest.close(); } catch (_) { /* ignore */ }
  });
  UI.showScreen('home');
}

boot();
