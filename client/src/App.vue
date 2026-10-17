<script setup>
import { onMounted, ref, watchEffect } from 'vue';
import { store, act } from './store.js';
import { api } from './api.js';
import OverviewCards from './components/OverviewCards.vue';
import AgentPanel from './components/AgentPanel.vue';
import GoalsPanel from './components/GoalsPanel.vue';
import BudgetsPanel from './components/BudgetsPanel.vue';
import TransactionsPanel from './components/TransactionsPanel.vue';

const confirmReset = ref(false);

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

async function reset() {
  if (!confirmReset.value) {
    confirmReset.value = true;
    setTimeout(() => (confirmReset.value = false), 3000);
    return;
  }
  confirmReset.value = false;
  await act(api.reset());
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="orb" aria-hidden="true"></span>
      <div>
        <strong>Lumina</strong>
        <span class="muted">Wealth that follows your goals</span>
      </div>
    </div>
    <div class="header-actions">
      <button class="ghost" :aria-label="`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`" @click="theme = theme === 'light' ? 'dark' : 'light'">
        {{ theme === 'light' ? '☾ Dark' : '☀ Light' }}
      </button>
      <button class="ghost" :class="{ danger: confirmReset }" @click="reset">
        {{ confirmReset ? 'Click again to reset' : 'Reset demo data' }}
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
        <AgentPanel />
      </aside>
    </div>
  </main>
  <p v-else-if="!store.error" class="page muted">Loading…</p>
</template>
