// One reactive store for the whole app. Every server call returns the full state,
// so `act()` just swaps it in. Components read `store.data` and call `act(api.x(...))`.
import { reactive } from 'vue';

// flash: ids of budgets the rådgiver just changed, so the Budgetter panel can highlight them.
export const store = reactive({ data: null, error: '', busy: false, flash: new Set() });

export async function act(promise) {
  store.busy = true;
  store.error = '';
  try {
    store.data = await promise;
    return true;
  } catch (err) {
    store.error = err.message;
    return false;
  } finally {
    store.busy = false;
  }
}

const currency = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 });
export const money = (n) => currency.format(Math.round(n));

export const month = (ym) => {
  if (!ym) return 'aldrig';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('da-DK', { month: 'short', year: 'numeric' });
};

export const day = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleString('da-DK', { month: 'short', day: 'numeric' });
};
