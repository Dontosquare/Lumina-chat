async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Forespørgslen mislykkedes (${res.status})`);
  return data;
}

export const api = {
  state: () => request('GET', '/api/state'),
  setIncome: (income) => request('PATCH', '/api/income', { income }),
  setBudget: (id, monthly) => request('PATCH', `/api/budgets/${id}`, { monthly }),
  addTransaction: (t) => request('POST', '/api/transactions', t),
  deleteTransaction: (id) => request('DELETE', `/api/transactions/${id}`),
  previewImport: (text, mapping) => request('POST', '/api/import/preview', { text, mapping }),
  importTransactions: (rows) => request('POST', '/api/import', { rows }),
  addGoal: (g) => request('POST', '/api/goals', g),
  deleteGoal: (id) => request('DELETE', `/api/goals/${id}`),
  runAgent: (intent) => request('POST', '/api/agent/run', intent),
  apply: (id) => request('POST', `/api/agent/suggestions/${id}/apply`),
  dismiss: (id) => request('POST', `/api/agent/suggestions/${id}/dismiss`),
  reset: () => request('POST', '/api/reset'),
  clear: () => request('POST', '/api/clear'),
};
