// First-strength momentum for cbBTC: takes exactly one trade - the day's
// first impulsive rise (30-minute return above +0.3%) - and holds it on a
// fixed horizon with a disaster stop. The day's first impulse is the genuine
// one; later pops on a one-day tape are counter-trend noise.
import { runBars, type BarsState, type Batch, type OrderInput } from './makefun-bars.ts';

const SYM = 'CBBTC';
const TRIG = 0.0022;
const HOLD = 300;
const SL = 0.012;         // disaster stop vs average entry
const TP = 0.015;         // take profit vs average entry
const SIZE_FRAC = 80n;
const SLIP_BPS = 200;

const closes: number[] = [];
let entryPx: number | null = null;
let heldMin = 0;
let traded = false;

function avgEntry(state: BarsState): number | null {
  const h = state.positions.get(SYM);
  if (!h || h.qty <= 0n) return null;
  return (Number(h.cost) / 1e6) / (Number(h.qty) / 1e8);
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] | null {
    if (state.warmingUp) return null;
    const raw = state.close(SYM);
    if (raw === null) return null;
    const px = Number(raw) / 10 ** (state.symbols.get(SYM)?.price_scale ?? 8);
    closes.push(px);
    const pos = state.positions.get(SYM);
    const holding = !!pos && pos.qty > 0n;

    if (holding) {
      if (entryPx === null) entryPx = avgEntry(state) ?? px;
      heldMin += 1;
      const gain = px / entryPx - 1;
      if (gain >= TP || gain <= -SL || heldMin >= HOLD) {
        entryPx = null;
        heldMin = 0;
        return [{ side: 'sell', symbol: SYM, qty: pos.qty, max_slippage_bps: SLIP_BPS }];
      }
      return null;
    }

    if (traded || closes.length < 31) return null;
    if (px / closes[closes.length - 31] - 1 > TRIG) {
      const room = state.weightRoom(SYM);
      const byCash = (state.cash * SIZE_FRAC) / 100n;
      const byRoom = (room * 98n) / 100n;
      const spend = byCash < byRoom ? byCash : byRoom;
      if (spend > 0n) {
        traded = true;
        return [{ side: 'buy', symbol: SYM, notional_quote_units: spend, max_slippage_bps: SLIP_BPS }];
      }
    }
    return null;
  },
});
