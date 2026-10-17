// One reactive store for the whole app. Every server call returns the full state,
// so `act()` just swaps it in. Components read `store.data` and call `act(api.x(...))`.
import { reactive } from 'vue';

export const store = reactive({ data: null, error: '', busy: false });

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
  if (!ym) return 'never';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

export const day = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short', day: 'numeric' });
};
