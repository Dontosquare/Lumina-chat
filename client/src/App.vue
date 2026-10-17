<script setup>
import { onMounted, ref, watchEffect } from 'vue';
import { store, act } from './store.js';
import { api } from './api.js';
import OverviewCards from './components/OverviewCards.vue';
import AgentPanel from './components/AgentPanel.vue';
import ChatPanel from './components/ChatPanel.vue';
import GoalsPanel from './components/GoalsPanel.vue';
import BudgetsPanel from './components/BudgetsPanel.vue';
import TransactionsPanel from './components/TransactionsPanel.vue';

// Both destructive header buttons need a second click within 3 seconds.
const confirming = ref(null); // 'reset' | 'clear' | null
let confirmTimer;
async function confirmThen(kind, call) {
  if (confirming.value !== kind) {
    confirming.value = kind;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirming.value = null), 3000);
    return;
  }
  confirming.value = null;
  await act(call());
}

// Light is the default; the choice is remembered in this browser.
const readTheme = () => {
  try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
};
const theme = ref(readTheme());
watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  try { localStorage.setItem('theme', theme.value); } catch {}
});

onMounted(() => act(api.state()));
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="orb" aria-hidden="true"></span>
      <div>
        <strong>Lumina</strong>
        <span class="muted">Økonomi, der følger dine mål</span>
      </div>
    </div>
    <div class="header-actions">
      <button class="ghost" :aria-label="theme === 'light' ? 'Skift til mørk tilstand' : 'Skift til lys tilstand'" @click="theme = theme === 'light' ? 'dark' : 'light'">
        {{ theme === 'light' ? '☾ Mørk' : '☀ Lys' }}
      </button>
      <button
        class="ghost"
        :class="{ danger: confirming === 'clear' }"
        title="Sæt indkomst og alle budgetter til 0 og fjern mål og posteringer"
        @click="confirmThen('clear', api.clear)"
      >
        {{ confirming === 'clear' ? 'Klik igen for at rydde alt' : 'Ryd alt' }}
      </button>
      <button class="ghost" :class="{ danger: confirming === 'reset' }" @click="confirmThen('reset', api.reset)">
        {{ confirming === 'reset' ? 'Klik igen for at nulstille' : 'Nulstil demodata' }}
      </button>
    </div>
  </header>

  <p v-if="store.error" class="toast" role="alert" @click="store.error = ''">{{ store.error }}</p>

  <main v-if="store.data" class="page">
    <OverviewCards />
    <div class="layout">
      <div class="col">
        <GoalsPanel />
        <BudgetsPanel />
        <TransactionsPanel />
      </div>
      <aside class="col agent-col">
        <ChatPanel />
        <AgentPanel />
      </aside>
    </div>
  </main>
  <p v-else-if="!store.error" class="page muted">Indlæser…</p>
</template>
