<script setup>
import { ref, computed } from 'vue';
import { store, act, money, day } from '../store.js';
import { api } from '../api.js';
import CsvImport from './CsvImport.vue';

const form = ref({ date: '', category: 'groceries', amount: '', note: '' });
const names = computed(() => Object.fromEntries(store.data.categories.map((c) => [c.id, c.name])));

async function add() {
  const ok = await act(api.addTransaction({ ...form.value, date: form.value.date || store.data.today }));
  if (ok) form.value = { ...form.value, amount: '', note: '' };
}

const picker = ref(null);
const file = ref(null);
const imported = ref(0);
let importedTimer;
function choose(e) {
  file.value = e.target.files[0] || null;
  e.target.value = ''; // so picking the same file again still triggers a change
}
function finished(count) {
  file.value = null;
  if (!count) return;
  imported.value = count;
  clearTimeout(importedTimer);
  importedTimer = setTimeout(() => (imported.value = 0), 5000);
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>Seneste forbrug</h2>
      <button v-if="!file" class="ghost small" title="Importér posteringer fra din banks CSV-eksport" @click="picker.click()">Importér CSV</button>
      <input ref="picker" type="file" accept=".csv,.txt,text/csv" hidden @change="choose" />
    </header>

    <CsvImport v-if="file" :key="file.name + file.lastModified" :file="file" @done="finished" />
    <p v-if="imported" class="status import-done">{{ imported }} {{ imported === 1 ? 'postering' : 'posteringer' }} importeret</p>

    <form class="tx-form" @submit.prevent="add">
      <input v-model="form.date" type="date" :max="store.data.today" aria-label="Dato" />
      <select v-model="form.category" aria-label="Kategori">
        <option v-for="c in store.data.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model.number="form.amount" type="number" min="0.01" step="0.01" placeholder="Beløb" required aria-label="Beløb" />
      <input v-model="form.note" placeholder="Note (valgfri)" aria-label="Note" />
      <button class="primary" :disabled="store.busy">Tilføj</button>
    </form>

    <p v-if="!store.data.transactions.length" class="muted">Ingen posteringer endnu. Tilføj dit første forbrug ovenfor.</p>
    <ul class="tx-list">
      <li v-for="t in store.data.transactions" :key="t.id">
        <span class="tx-date muted">{{ day(t.date) }}</span>
        <span class="tx-note">{{ t.note || names[t.category] }}<span class="tag">{{ names[t.category] }}</span></span>
        <span class="tx-amount">{{ money(t.amount) }}</span>
        <button class="icon" title="Slet" aria-label="Slet postering" @click="act(api.deleteTransaction(t.id))">×</button>
      </li>
    </ul>
  </section>
</template>
