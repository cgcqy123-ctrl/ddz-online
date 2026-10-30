// 对局状态机测试：发牌、叫分、出牌、倍数、结算
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../js/game.js';
import { findHints, getCombo } from '../js/rules.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame() {
  const g = new Game([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  g.startRound();
  return g;
}

/** 叫分直到有人当地主（随机策略，保证不会连续弃权） */
function runBidding(g, rnd = Math.random) {
  let guard = 0;
  while (g.phase === PHASE.BID) {
    if (guard++ > 200) throw new Error('叫分没有结束');
    const seat = g.turn;
    const want = 1 + Math.floor(rnd() * 3);
    const value = want > g.bidHigh ? want : 0;
    g.action(seat, { type: 'bid', value });
  }
}

test('发牌：17/17/17 + 底牌 3 张，共 54 张不重复', () => {
  const g = newGame();
  const all = [];
  for (const p of g.seats) {
    assert.equal(p.hand.length, 17);
    all.push(...p.hand);
  }
  assert.equal(g.bottom.length, 3);
  all.push(...g.bottom);
  assert.equal(all.length, 54);
  assert.equal(new Set(all.map((c) => c.id)).size, 54);
  assert.equal(g.phase, PHASE.BID);
});

test('叫 3 分立刻成为地主并拿到底牌', () => {
  const g = newGame();
  const seat = g.turn;
  g.action(seat, { type: 'bid', value: 3 });
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.landlord, seat);
  assert.equal(g.baseScore, 3);
  assert.equal(g.seats[seat].hand.length, 20);
  assert.equal(g.turn, seat, '地主先出');
  assert.equal(g.bottom.length, 3);
});

test('叫分必须递增且不能越权操作', () => {
  const g = newGame();
  const first = g.turn;
  const second = (first + 1) % 3;
  assert.throws(() => g.action(second, { type: 'bid', value: 1 }), /还没轮到你/);
  g.action(first, { type: 'bid', value: 2 });
  assert.throws(() => g.action(second, { type: 'bid', value: 2 }), /必须高于/);
  assert.throws(() => g.action(second, { type: 'bid', value: 1 }), /必须高于/);
  g.action(second, { type: 'bid', value: 3 });
  assert.equal(g.landlord, second);
});

test('出牌校验：不是自己的牌 / 非法牌型 / 压不过', () => {
  const g = newGame();
  g.action(g.turn, { type: 'bid', value: 3 });
  const seat = g.landlord;
  const other = (seat + 1) % 3;
  assert.throws(() => g.action(other, { type: 'play', cards: [g.seats[other].hand[0].id] }), /还没轮到你/);
  assert.throws(
    () => g.action(seat, { type: 'play', cards: [g.seats[other].hand[0].id] }),
    /牌不在你手里/
  );
  // 找两张点数不同、且凑不成任何牌型的牌
  const hand = g.seats[seat].hand;
  let pair = null;
  for (let i = 0; i < hand.length && !pair; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (!getCombo([hand[i], hand[j]])) {
        pair = [hand[i], hand[j]];
        break;
      }
    }
  }
  assert.ok(pair, '手里总能找出两张凑不成牌型的牌');
  assert.throws(() => g.action(seat, { type: 'play', cards: [pair[0].id, pair[1].id] }), /合法牌型/);
  assert.throws(() => g.action(seat, { type: 'pass' }), /必须出牌/);
});

test('两家都不要后重新自由出牌', () => {
  const g = newGame();
  g.action(g.turn, { type: 'bid', value: 3 });
  const lord = g.landlord;
  // 地主出最小单张
  const hand = g.seats[lord].hand;
  const card = hand[hand.length - 1];
  g.action(lord, { type: 'play', cards: [card.id] });
  assert.equal(g.lastPlay.seat, lord);
  const p1 = (lord + 1) % 3;
  const p2 = (lord + 2) % 3;
  // 只有手牌里没有更大的牌时才不出（这里用手动 pass 测试状态机）
  g.action(p1, { type: 'pass' });
  assert.equal(g.lastPlay.seat, lord, '一人不出还没轮空');
  g.action(p2, { type: 'pass' });
  assert.equal(g.turn, lord, '轮到地主重新领出');
  assert.equal(g.lastPlay, null);
  assert.equal(g.passCount, 0);
});

test('炸弹翻倍', () => {
  const g = newGame();
  g.action(g.turn, { type: 'bid', value: 3 });
  const lord = g.landlord;
  // 手动塞一手炸弹给地主，验证倍数
  g.seats[lord].hand = [
    { id: '7♠', r: 7, s: '♠' },
    { id: '7♥', r: 7, s: '♥' },
    { id: '7♣', r: 7, s: '♣' },
    { id: '7♦', r: 7, s: '♦' },
    { id: '3♠', r: 3, s: '♠' },
  ];
  const before = g.multiplier;
  g.action(lord, { type: 'play', cards: ['7♠', '7♥', '7♣', '7♦'] });
  assert.equal(g.multiplier, before * 2);
  assert.equal(g.seats[lord].hand.length, 1);
});

test('出完牌即结算，且分数守恒', () => {
  const g = newGame();
  g.action(g.turn, { type: 'bid', value: 3 });
  const lord = g.landlord;
  g.seats[lord].hand = [{ id: '5♠', r: 5, s: '♠' }];
  // 农民手牌保留，地主只剩一张
  g.action(lord, { type: 'play', cards: ['5♠'] });
  assert.equal(g.phase, PHASE.OVER);
  assert.equal(g.result.landlordWin, true);
  assert.equal(g.winnerSeat, lord);
  assert.equal(g.result.deltas.reduce((a, b) => a + b, 0), 0, '三家分数相加为 0');
  assert.equal(g.result.deltas[lord], 2 * g.result.score);
});

test('春天：农民一张没出，倍数再翻一倍', () => {
  const g = newGame();
  const starter = g.turn;
  g.action(starter, { type: 'bid', value: 1 });
  g.action((starter + 1) % 3, { type: 'bid', value: 0 });
  g.action((starter + 2) % 3, { type: 'bid', value: 0 });
  assert.equal(g.phase, PHASE.PLAY);
  const lord = g.landlord;
  assert.equal(g.baseScore, 1);
  g.seats[lord].hand = [{ id: '5♠', r: 5, s: '♠' }];
  g.action(lord, { type: 'play', cards: ['5♠'] });
  assert.equal(g.result.spring, true);
  assert.equal(g.multiplier, 2);
  assert.equal(g.baseScore, 1);
  assert.equal(g.result.score, 2);
});

test('视图不泄露别人的手牌', () => {
  const g = newGame();
  g.action(g.turn, { type: 'bid', value: 3 });
  const v = g.view((g.landlord + 1) % 3);
  assert.equal(v.hand.length, 17);
  assert.ok(!('hands' in v));
  assert.equal(v.seats.length, 3);
  assert.ok(v.seats.every((s) => typeof s.count === 'number' && s.hand === undefined));
  assert.equal(v.bottom.length, 3, '地主确定后底牌公开');
});

test('随机完整对局：能正常结束且牌数守恒（200 局）', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = mulberry32(seed);
    const g = newGame();
    runBidding(g, rnd);
    let guard = 0;
    while (g.phase === PHASE.PLAY) {
      if (guard++ > 2000) throw new Error('对局没有结束, seed=' + seed);
      const seat = g.turn;
      const handCards = g.seats[seat].hand;
      const last = g.lastPlay ? g.lastPlay.combo : null;
      const hints = findHints(handCards, last);
      if (!hints.length) {
        if (!last) throw new Error('自由出牌时居然没有可出的牌');
        g.action(seat, { type: 'pass' });
        continue;
      }
      const pick = hints[Math.floor(rnd() * hints.length)];
      g.action(seat, { type: 'play', cards: pick.cards.map((c) => c.id) });
      // 不变量：三家手牌 + 已出的牌 = 54
      const inHands = g.seats.reduce((n, p) => n + p.hand.length, 0);
      if (inHands > 54 || inHands < 0) throw new Error('牌数异常');
    }
    assert.equal(g.phase, PHASE.OVER, 'seed ' + seed);
    assert.ok(g.result, 'seed ' + seed);
    assert.equal(g.result.deltas.reduce((a, b) => a + b, 0), 0);
    assert.ok(['landlord', 'farmer'].includes(g.result.landlordWin ? 'landlord' : 'farmer'));
    assert.equal(g.seats.filter((p) => p.hand.length === 0).length, 1, '只有一个人出完');
  }
});

test('所有出牌都必须是合法牌型（随机对局中复核）', () => {
  const rnd = mulberry32(7);
  const g = newGame();
  runBidding(g, rnd);
  let guard = 0;
  while (g.phase === PHASE.PLAY && guard++ < 2000) {
    const seat = g.turn;
    const last = g.lastPlay ? g.lastPlay.combo : null;
    const hints = findHints(g.seats[seat].hand, last);
    if (!hints.length) {
      g.action(seat, { type: 'pass' });
      continue;
    }
    const pick = hints[0];
    const combo = getCombo(pick.cards);
    assert.ok(combo, '出牌牌型必须合法');
    g.action(seat, { type: 'play', cards: pick.cards.map((c) => c.id) });
  }
  assert.equal(g.phase, PHASE.OVER);
});
