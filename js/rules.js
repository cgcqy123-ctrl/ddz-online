// 斗地主牌型规则（纯逻辑，不依赖 DOM，可在 Node 中直接单测）
//
// 牌的表示：{ id, r, s }
//   r 为点数权重：3..10 => 3..10，11=J，12=Q，13=K，14=A，15=2，16=小王，17=大王
//   s 为花色：♠ ♥ ♣ ♦，大小王为空串
//   id 唯一，形如 "14♥"、"17joker"

export const SUITS = ['♠', '♥', '♣', '♦'];

export const RANK_LABEL = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

export const TYPE_LABEL = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  triple1: '三带一',
  triple2: '三带二',
  straight: '顺子',
  pairseq: '连对',
  plane: '飞机',
  plane1: '飞机带单',
  plane2: '飞机带对',
  four2: '四带二',
  four22: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
};

/** 生成一副 54 张牌 */
export function makeDeck() {
  const deck = [];
  for (let r = 3; r <= 15; r++) {
    for (const s of SUITS) deck.push({ id: r + s, r, s });
  }
  deck.push({ id: '16joker', r: 16, s: '' });
  deck.push({ id: '17joker', r: 17, s: '' });
  return deck;
}

/** 洗牌（返回新数组） */
export function shuffle(cards, rnd = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 手牌排序：大点数在左 */
export function sortCards(cards) {
  return cards.slice().sort((x, y) => y.r - x.r || SUITS.indexOf(x.s) - SUITS.indexOf(y.s));
}

export function cardLabel(card) {
  if (card.r === 16) return '小王';
  if (card.r === 17) return '大王';
  return card.s + RANK_LABEL[card.r];
}

export function cardsLabel(cards) {
  return cards.map(cardLabel).join(' ');
}

function countRanks(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.r, (m.get(c.r) || 0) + 1);
  return m;
}

function isRun(ranks) {
  for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
  return true;
}

function mk(type, main, len, cards) {
  return { type, main, len, cards: sortCards(cards) };
}

/**
 * 识别牌型。合法返回 { type, main, len, cards }，否则返回 null。
 * main 用于同牌型比大小（顺子/连对/飞机取最大的那张）。
 */
export function getCombo(cards) {
  if (!cards || !cards.length) return null;
  const n = cards.length;
  const cnt = countRanks(cards);
  const ranks = [...cnt.keys()].sort((a, b) => a - b);
  const withCount = (k) => ranks.filter((r) => cnt.get(r) === k);
  const top = ranks[ranks.length - 1];

  // 王炸 / 炸弹
  if (n === 2 && cnt.get(16) === 1 && cnt.get(17) === 1) return mk('rocket', 100, 2, cards);
  if (n === 4 && ranks.length === 1) return mk('bomb', ranks[0], 4, cards);
  // 单张 / 对子 / 三张
  if (n === 1) return mk('single', ranks[0], 1, cards);
  if (n === 2) return ranks.length === 1 ? mk('pair', ranks[0], 2, cards) : null;
  if (n === 3) return ranks.length === 1 ? mk('triple', ranks[0], 3, cards) : null;
  // 三带一 / 三带二
  if (n === 4) {
    const t = withCount(3);
    return t.length === 1 ? mk('triple1', t[0], 4, cards) : null;
  }
  if (n === 5) {
    const t = withCount(3);
    const p = withCount(2);
    if (t.length === 1 && p.length === 1) return mk('triple2', t[0], 5, cards);
  }
  // 顺子（至少 5 张，不含 2 和王）
  if (n >= 5 && ranks.length === n && top <= 14 && isRun(ranks)) return mk('straight', top, n, cards);
  // 连对（至少 3 对，不含 2 和王）
  if (
    n >= 6 && n % 2 === 0 && ranks.length === n / 2 && top <= 14 &&
    isRun(ranks) && ranks.every((r) => cnt.get(r) === 2)
  ) {
    return mk('pairseq', top, n, cards);
  }
  // 四带二 / 四带两对
  if (n === 6) {
    const f = withCount(4);
    if (f.length === 1) return mk('four2', f[0], 6, cards);
  }
  if (n === 8) {
    const f = withCount(4);
    const p = withCount(2);
    if (f.length === 1 && p.length === 2) return mk('four22', f[0], 8, cards);
  }
  // 飞机（连续三张，可带同数量的单牌或对子）
  return detectPlane(cards, cnt, ranks, n);
}

function detectPlane(cards, cnt, ranks, n) {
  const bodyRanks = ranks.filter((r) => cnt.get(r) >= 3 && r <= 14);
  for (let i = 0; i < bodyRanks.length; i++) {
    // 从 i 开始取一段连续的三张
    const run = [bodyRanks[i]];
    for (let j = i + 1; j < bodyRanks.length && bodyRanks[j] === bodyRanks[j - 1] + 1; j++) {
      run.push(bodyRanks[j]);
    }
    for (let s = 0; s < run.length; s++) {
      for (let e = s + 1; e < run.length; e++) {
        const body = run.slice(s, e + 1);
        const k = body.length; // 三张的组数
        const bodyLen = 3 * k;
        const top = body[k - 1];
        if (n === bodyLen) {
          if (body.length === ranks.length && body.every((r) => cnt.get(r) === 3)) {
            return mk('plane', top, n, cards);
          }
          continue;
        }
        // 剩余牌（扣掉机身）
        const rest = new Map();
        for (const r of ranks) {
          const c = cnt.get(r) - (body.includes(r) ? 3 : 0);
          if (c > 0) rest.set(r, c);
        }
        const restCount = [...rest.values()].reduce((a, b) => a + b, 0);
        if (n === bodyLen + k && restCount === k) return mk('plane1', top, n, cards);
        if (n === bodyLen + 2 * k && rest.size === k && [...rest.values()].every((v) => v === 2)) {
          return mk('plane2', top, n, cards);
        }
      }
    }
  }
  return null;
}

/** newCombo 能否打得过 lastCombo（lastCombo 为 null 表示自由出牌） */
export function canBeat(newCombo, lastCombo) {
  if (!newCombo) return false;
  if (!lastCombo) return true;
  const nt = newCombo.type;
  const lt = lastCombo.type;
  if (nt === 'rocket') return lt !== 'rocket';
  if (lt === 'rocket') return false;
  if (nt === 'bomb') return lt === 'bomb' ? newCombo.main > lastCombo.main : true;
  if (lt === 'bomb') return false;
  return nt === lt && newCombo.len === lastCombo.len && newCombo.main > lastCombo.main;
}

/** 枚举手中所有可出的牌型（每类只取一组最省牌的组合，用于「提示」） */
export function findAllCombos(hand) {
  const res = [];
  const cnt = countRanks(hand);
  const ranks = [...cnt.keys()].sort((a, b) => a - b);
  const pick = (r, k) => hand.filter((c) => c.r === r).slice(0, k);
  const add = (cards) => {
    if (!cards || !cards.length) return;
    const c = getCombo(cards);
    if (c) res.push(c);
  };

  // 单 / 对 / 三 / 炸 / 王炸
  for (const r of ranks) {
    add(pick(r, 1));
    if (cnt.get(r) >= 2) add(pick(r, 2));
    if (cnt.get(r) >= 3) add(pick(r, 3));
    if (cnt.get(r) >= 4) add(pick(r, 4));
  }
  if (cnt.get(16) && cnt.get(17)) add([...pick(16, 1), ...pick(17, 1)]);

  // 三带一 / 三带二
  for (const t of ranks.filter((r) => cnt.get(r) >= 3)) {
    for (const s of ranks) {
      if (s === t) continue;
      add([...pick(t, 3), ...pick(s, 1)]);
      if (cnt.get(s) >= 2) add([...pick(t, 3), ...pick(s, 2)]);
    }
  }

  // 四带二 / 四带两对
  for (const f of ranks.filter((r) => cnt.get(r) >= 4)) {
    const others = ranks.filter((r) => r !== f);
    const twoSingles = [];
    for (const s of others) {
      twoSingles.push(...pick(s, 1));
      if (twoSingles.length >= 2) break;
    }
    if (twoSingles.length >= 2) add([...pick(f, 4), twoSingles[0], twoSingles[1]]);
    const pairRanks = others.filter((r) => cnt.get(r) >= 2);
    if (pairRanks.length >= 2) {
      add([...pick(f, 4), ...pick(pairRanks[0], 2), ...pick(pairRanks[1], 2)]);
    }
  }

  // 顺子
  for (let start = 3; start <= 10; start++) {
    const cards = [];
    for (let r = start; r <= 14; r++) {
      if (!cnt.get(r)) break;
      cards.push(...pick(r, 1));
      if (cards.length >= 5) add(cards.slice());
    }
  }

  // 连对
  for (let start = 3; start <= 12; start++) {
    const cards = [];
    for (let r = start; r <= 14; r++) {
      if (!cnt.get(r) || cnt.get(r) < 2) break;
      cards.push(...pick(r, 2));
      if (cards.length >= 6) add(cards.slice());
    }
  }

  // 飞机 / 飞机带单 / 飞机带对
  for (let start = 3; start <= 12; start++) {
    const body = [];
    for (let r = start; r <= 14; r++) {
      if (!cnt.get(r) || cnt.get(r) < 3) break;
      body.push(r);
      const k = body.length;
      if (k < 2) continue;
      const bodyCards = body.flatMap((br) => pick(br, 3));
      add(bodyCards.slice());
      const pool = hand.filter((c) => !body.includes(c.r));
      if (pool.length >= k) add([...bodyCards, ...sortCards(pool).slice(-k)]);
      const pairRanks = ranks.filter((r2) => !body.includes(r2) && cnt.get(r2) >= 2);
      if (pairRanks.length >= k) {
        add([...bodyCards, ...pairRanks.slice(0, k).flatMap((r2) => pick(r2, 2))]);
      }
    }
  }

  return res;
}

/**
 * 提示：返回所有能压过 lastCombo 的出法（lastCombo 为 null 时返回推荐领出）。
 * 结果已排序，第一个就是最推荐的一手。
 */
export function findHints(hand, lastCombo) {
  const seen = new Set();
  const out = [];
  for (const c of findAllCombos(hand)) {
    const key = c.type + '|' + c.len + '|' + c.main;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!canBeat(c, lastCombo)) continue;
    out.push(c);
  }
  const weight = (c) => (c.type === 'rocket' ? 3 : c.type === 'bomb' ? 2 : 1);
  if (lastCombo) {
    out.sort((a, b) => weight(a) - weight(b) || a.main - b.main || a.len - b.len);
  } else {
    out.sort((a, b) => weight(a) - weight(b) || a.len - b.len || a.main - b.main);
  }
  return out;
}

/** 手里有没有能压过 lastCombo 的牌 */
export function hasBeating(hand, lastCombo) {
  return findHints(hand, lastCombo).length > 0;
}
