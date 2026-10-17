<script setup>
import { ref, computed } from 'vue';
import { store, act, money, day } from '../store.js';
import { api } from '../api.js';

const form = ref({ date: '', category: 'groceries', amount: '', note: '' });
const names = computed(() => Object.fromEntries(store.data.categories.map((c) => [c.id, c.name])));

async function add() {
  const ok = await act(api.addTransaction({ ...form.value, date: form.value.date || store.data.today }));
  if (ok) form.value = { ...form.value, amount: '', note: '' };
}
</script>

<template>
  <section class="panel">
    <header class="panel-head"><h2>Recent spending</h2></header>

    <form class="tx-form" @submit.prevent="add">
      <input v-model="form.date" type="date" :max="store.data.today" aria-label="Date" />
      <select v-model="form.category" aria-label="Category">
        <option v-for="c in store.data.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model.number="form.amount" type="number" min="0.01" step="0.01" placeholder="Amount" required aria-label="Amount" />
      <input v-model="form.note" placeholder="Note (optional)" aria-label="Note" />
      <button class="primary" :disabled="store.busy">Add</button>
    </form>

    <ul class="tx-list">
      <li v-for="t in store.data.transactions" :key="t.id">
        <span class="tx-date muted">{{ day(t.date) }}</span>
        <span class="tx-note">{{ t.note || names[t.category] }}<span class="tag">{{ names[t.category] }}</span></span>
        <span class="tx-amount">{{ money(t.amount) }}</span>
        <button class="icon" title="Delete" aria-label="Delete transaction" @click="act(api.deleteTransaction(t.id))">×</button>
      </li>
    </ul>
  </section>
</template>
