// 牌型规则单元测试：node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCombo, canBeat, makeDeck, shuffle, findHints, sortCards } from '../js/rules.js';

/** 用点数构造一组牌，花色自动分配（同点数最多 4 张） */
function hand(ranks) {
  const used = new Map();
  const suits = ['♠', '♥', '♣', '♦'];
  return ranks.map((r) => {
    if (r >= 16) return { id: r + 'joker', r, s: '' };
    const k = used.get(r) || 0;
    used.set(r, k + 1);
    return { id: r + suits[k], r, s: suits[k] };
  });
}
const typeOf = (ranks) => (getCombo(hand(ranks)) || {}).type || null;

test('整副牌 54 张且互不重复', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map((c) => c.id)).size, 54);
  const shuffled = shuffle(deck);
  assert.equal(shuffled.length, 54);
  assert.equal(new Set(shuffled.map((c) => c.id)).size, 54);
});

test('基本牌型识别', () => {
  assert.equal(typeOf([3]), 'single');
  assert.equal(typeOf([15]), 'single');
  assert.equal(typeOf([16]), 'single');
  assert.equal(typeOf([3, 3]), 'pair');
  assert.equal(typeOf([3, 3, 3]), 'triple');
  assert.equal(typeOf([16, 17]), 'rocket');
  assert.equal(typeOf([9, 9, 9, 9]), 'bomb');
  assert.equal(typeOf([3, 3, 3, 7]), 'triple1');
  assert.equal(typeOf([3, 3, 3, 7, 7]), 'triple2');
  assert.equal(typeOf([3, 5]), null, '两张不同点数不是牌型');
  assert.equal(typeOf([3, 4, 5, 6]), null, '四张连不成顺子');
});

test('顺子 / 连对 / 飞机', () => {
  assert.equal(typeOf([3, 4, 5, 6, 7]), 'straight');
  assert.equal(typeOf([10, 11, 12, 13, 14]), 'straight');
  assert.equal(typeOf([11, 12, 13, 14, 15]), null, '2 不能进顺子');
  assert.equal(typeOf([13, 14, 15, 16, 17]), null, '王不能进顺子');
  assert.equal(typeOf([3, 3, 4, 4, 5, 5]), 'pairseq');
  assert.equal(typeOf([3, 3, 4, 4]), null, '连对至少 3 对');
  assert.equal(typeOf([14, 14, 15, 16, 16]), null, '含王的散牌不是牌型');
  assert.equal(typeOf([3, 3, 3, 4, 4, 4]), 'plane');
  assert.equal(typeOf([3, 3, 3, 5, 5, 5]), null, '飞机必须连续');
  assert.equal(typeOf([3, 3, 3, 4, 4, 4, 7, 8]), 'plane1');
  assert.equal(typeOf([3, 3, 3, 4, 4, 4, 7, 7, 8, 8]), 'plane2');
  assert.equal(typeOf([15, 15, 15, 15]), 'bomb', '2 可以当炸弹');
});

test('四带二', () => {
  assert.equal(typeOf([5, 5, 5, 5, 8, 9]), 'four2');
  assert.equal(typeOf([5, 5, 5, 5, 8, 8, 9, 9]), 'four22');
});

test('大小比较', () => {
  const c = (ranks) => getCombo(hand(ranks));
  assert.ok(canBeat(c([4]), null), '自由出牌什么都能出');
  assert.ok(canBeat(c([4]), c([3])));
  assert.ok(!canBeat(c([3]), c([4])));
  assert.ok(!canBeat(c([4, 4]), c([3])), '牌型不同不能比较');
  assert.ok(canBeat(c([9, 9, 9, 9]), c([14])), '炸弹能压单张');
  assert.ok(canBeat(c([15, 15, 15, 15]), c([13, 13, 13, 13])), '炸弹比大小');
  assert.ok(!canBeat(c([3, 3, 3, 3]), c([13, 13, 13, 13])), '小炸弹压不过大炸弹');
  assert.ok(canBeat(c([16, 17]), c([15, 15, 15, 15])), '王炸压炸弹');
  assert.ok(!canBeat(c([14]), c([16, 17])), '非王炸压不过王炸');
  assert.ok(canBeat(c([4, 5, 6, 7, 8]), c([3, 4, 5, 6, 7])), '同长度顺子比大小');
  assert.ok(!canBeat(c([4, 5, 6, 7, 8, 9]), c([3, 4, 5, 6, 7])), '顺子长度必须相同');
});

test('提示：能压过上家且不推荐拆王炸', () => {
  const h = hand([3, 3, 4, 5, 16, 17]);
  const hints = findHints(h, getCombo(hand([3])));
  assert.ok(hints.length > 0);
  assert.ok(hints.every((c) => c.main > 3 || c.type === 'bomb' || c.type === 'rocket'));
  assert.equal(hints[0].type, 'single');
  assert.ok(hints[0].main < 16, '优先出小牌而不是拆王');
  const empty = findHints(hand([3, 4]), getCombo(hand([15, 15, 15, 15])));
  assert.equal(empty.length, 0, '打不过炸弹时提示为空');
});

test('提示：自由出牌给最小的一手', () => {
  const hints = findHints(hand([5, 3, 3, 14]), null);
  assert.ok(hints.length > 0);
  assert.equal(hints[0].cards[0].r, 3, '先出最小的 3');
});

test('排序：大牌在左', () => {
  const sorted = sortCards(hand([3, 17, 10, 16, 15]));
  assert.deepEqual(sorted.map((c) => c.r), [17, 16, 15, 10, 3]);
});
