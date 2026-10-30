// 斗地主对局状态机（纯逻辑，不依赖 DOM / 网络）
// 由房主（host）单方面运行，其他人只提交动作、接收视图。

const V = new URL(import.meta.url).search; // 跟随 index.html 的 ?v= 做缓存穿透
const { makeDeck, shuffle, sortCards, getCombo, canBeat } = await import('./rules.js' + V);

export const PHASE = { LOBBY: 'lobby', BID: 'bid', PLAY: 'play', OVER: 'over' };

export class Game {
  /** seats: [{ name, connected }]，固定 3 个座位 */
  constructor(seats) {
    this.seats = seats.map((s, i) => ({
      seat: i,
      name: s.name || '玩家' + (i + 1),
      connected: s.connected !== false,
      hand: [],
      plays: 0,
    }));
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.resetPublic();
  }

  resetPublic() {
    this.bottom = [];
    this.landlord = -1;
    this.turn = 0;
    this.startSeat = 0;
    this.bids = [null, null, null];
    this.bidHigh = 0;
    this.bidWinner = -1;
    this.bidCount = 0;
    this.lastPlay = null; // { seat, cards, combo }
    this.passCount = 0;
    this.recent = [null, null, null]; // 每人最近一次动作，用于牌桌展示
    this.multiplier = 1;
    this.baseScore = 1;
    this.winnerSeat = -1;
    this.result = null;
  }

  get nextSeat() {
    return (this.turn + 1) % 3;
  }

  /** 开新一局：洗牌发牌，进入叫分 */
  startRound() {
    this.resetPublic();
    const deck = shuffle(makeDeck());
    this.bottom = sortCards(deck.slice(51));
    this.seats.forEach((p, i) => {
      p.hand = sortCards(deck.slice(i * 17, i * 17 + 17));
      p.plays = 0;
    });
    this.round++;
    this.phase = PHASE.BID;
    this.startSeat = Math.floor(Math.random() * 3);
    this.turn = this.startSeat;
  }

  /** 统一动作入口：{ type:'bid', value } | { type:'play', cards } | { type:'pass' } */
  action(seat, act) {
    if (seat !== this.turn) throw new Error('还没轮到你');
    if (this.phase === PHASE.BID) return this.doBid(seat, act);
    if (this.phase === PHASE.PLAY) return this.doPlay(seat, act);
    throw new Error('当前不能操作');
  }

  doBid(seat, act) {
    if (act.type !== 'bid') throw new Error('请先叫分');
    const v = Number(act.value || 0);
    if (![0, 1, 2, 3].includes(v)) throw new Error('叫分无效');
    if (v > 0 && v <= this.bidHigh) throw new Error('叫分必须高于当前最高分');

    this.bids[seat] = v;
    this.bidCount++;
    if (v > 0) {
      this.bidHigh = v;
      this.bidWinner = seat;
    }
    this.recent[seat] = { kind: 'bid', value: v };

    if (this.bidHigh === 3 || this.bidCount === 3) {
      if (this.bidWinner < 0) {
        // 三家都不叫 → 重新发牌
        this._redeals = (this._redeals || 0) + 1;
        this.startRound();
        if (this._redeals > 20) {
          // 极小概率兜底：连续多次都不叫时强制起始玩家以 1 分当地主
          this._redeals = 0;
          this.bids[this.turn] = 1;
          this.setLandlord(this.turn, 1);
        }
        return { redeal: true };
      }
      this._redeals = 0;
      this.setLandlord(this.bidWinner, this.bidHigh);
      return { ok: true };
    }
    this.turn = this.nextSeat;
    return { ok: true };
  }

  setLandlord(seat, base) {
    this.landlord = seat;
    this.baseScore = base || 1;
    this.seats[seat].hand = sortCards([...this.seats[seat].hand, ...this.bottom]);
    this.phase = PHASE.PLAY;
    this.turn = seat;
    this.lastPlay = null;
    this.passCount = 0;
    this.recent = [null, null, null];
    this.recent[seat] = { kind: 'landlord', cards: this.bottom };
  }

  doPlay(seat, act) {
    if (act.type === 'pass') {
      if (!this.lastPlay) throw new Error('你必须出牌');
      this.passCount++;
      this.recent[seat] = { kind: 'pass' };
      this.turn = this.nextSeat;
      if (this.passCount === 2) {
        // 两家都不要，重新自由出牌（此时 turn 已指回上一个出牌的人）
        this.lastPlay = null;
        this.passCount = 0;
        this.recent = [null, null, null];
      }
      return { ok: true };
    }

    if (act.type !== 'play') throw new Error('无效操作');
    const ids = Array.isArray(act.cards) ? act.cards : [];
    if (!ids.length) throw new Error('请选择要出的牌');
    const hand = this.seats[seat].hand;
    const chosen = [];
    for (const id of new Set(ids)) {
      const c = hand.find((x) => x.id === id);
      if (!c) throw new Error('牌不在你手里');
      chosen.push(c);
    }
    const combo = getCombo(chosen);
    if (!combo) throw new Error('不是合法牌型');
    if (this.lastPlay && !canBeat(combo, this.lastPlay.combo)) throw new Error('打不过上家');

    const used = new Set(chosen.map((c) => c.id));
    this.seats[seat].hand = hand.filter((c) => !used.has(c.id));
    this.seats[seat].plays++;
    if (combo.type === 'bomb' || combo.type === 'rocket') this.multiplier *= 2;

    this.lastPlay = { seat, cards: combo.cards, combo };
    this.passCount = 0;
    this.recent[seat] = { kind: 'play', cards: combo.cards, combo };

    if (this.seats[seat].hand.length === 0) {
      this.finish(seat);
      return { ok: true, win: true };
    }
    this.turn = this.nextSeat;
    return { ok: true };
  }

  finish(winner) {
    this.phase = PHASE.OVER;
    this.winnerSeat = winner;
    const landlordWin = winner === this.landlord;
    const farmers = [0, 1, 2].filter((s) => s !== this.landlord);
    let spring = false;
    if (landlordWin) {
      // 春天：农民一张牌都没出过
      spring = farmers.every((s) => this.seats[s].plays === 0);
    } else {
      // 反春天：地主只出过一手牌
      spring = this.seats[this.landlord].plays <= 1;
    }
    if (spring) this.multiplier *= 2;
    const score = this.baseScore * this.multiplier;
    const deltas = [0, 0, 0];
    if (landlordWin) {
      deltas[this.landlord] = 2 * score;
      farmers.forEach((s) => (deltas[s] = -score));
    } else {
      deltas[this.landlord] = -2 * score;
      farmers.forEach((s) => (deltas[s] = score));
    }
    this.result = {
      landlordWin,
      spring,
      score,
      deltas,
      winner,
      landlord: this.landlord,
    };
    this.turn = -1;
  }

  /** 给某个座位生成可见视图（不含别人的手牌） */
  view(seat) {
    const me = this.seats[seat];
    return {
      phase: this.phase,
      round: this.round,
      seat,
      turn: this.turn,
      landlord: this.landlord,
      startSeat: this.startSeat,
      bottom: this.landlord >= 0 ? this.bottom : [],
      bottomCount: this.bottom.length,
      baseScore: this.baseScore,
      multiplier: this.multiplier,
      bids: this.bids,
      bidHigh: this.bidHigh,
      lastPlay: this.lastPlay
        ? { seat: this.lastPlay.seat, cards: this.lastPlay.cards, combo: this.lastPlay.combo }
        : null,
      recent: this.recent,
      seats: this.seats.map((p) => ({
        seat: p.seat,
        name: p.name,
        connected: p.connected,
        count: p.hand.length,
        plays: p.plays,
      })),
      hand: sortCards(me.hand),
      result: this.result,
    };
  }
}
