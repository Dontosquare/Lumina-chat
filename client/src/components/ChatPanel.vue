<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { store, act, money } from '../store.js';
import { api } from '../api.js';

const text = ref('');
const list = ref(null);
const EXAMPLES = ['Lav et budget med SU', 'SU hjemmeboende', 'Sæt dagligvarer til 2000', 'Sænk restaurant med 300', 'Hjælp'];

const messages = computed(() => store.data.chat ?? []);
// Only the newest change can be undone (older ones may have been built on top of).
const undoableId = computed(() => [...messages.value].reverse().find((m) => m.undo && !m.undone)?.id);

// Keep the newest message in view.
watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (list.value) list.value.scrollTop = list.value.scrollHeight;
  },
  { immediate: true },
);

// Briefly highlight the budget bars the rådgiver just changed.
function flashChanges(before) {
  const changed = store.data.categories.filter((c) => before[c.id] !== c.monthly).map((c) => c.id);
  if (!changed.length) return;
  store.flash = new Set(changed);
  setTimeout(() => (store.flash = new Set()), 2200);
}

async function send(message = text.value) {
  if (!message.trim() || store.busy) return;
  const before = Object.fromEntries(store.data.categories.map((c) => [c.id, c.monthly]));
  text.value = '';
  if (await act(api.chat(message))) flashChanges(before);
}

async function undo(id) {
  const before = Object.fromEntries(store.data.categories.map((c) => [c.id, c.monthly]));
  if (await act(api.undoChat(id))) flashChanges(before);
}
</script>

<template>
  <section class="panel chat">
    <header class="panel-head">
      <div>
        <h2>Skriv til rådgiveren</h2>
        <p class="muted">Rådgiveren ændrer dine budgetter med det samme. Du kan altid fortryde den seneste ændring.</p>
      </div>
    </header>

    <div ref="list" class="chat-list" aria-live="polite">
      <p v-if="!messages.length" class="chat-empty muted">Prøv at skrive "lav et budget med SU".</p>
      <div v-for="m in messages" :key="m.id" :class="['bubble', m.role, { undone: m.undone }]">
        <p class="bubble-text">{{ m.text }}</p>
        <ul v-if="m.changes?.length" class="moves">
          <li v-for="c in m.changes" :key="c.label">
            <span>{{ c.label }}</span>
            <strong>{{ money(c.from) }} → {{ money(c.to) }}</strong>
          </li>
        </ul>
        <button v-if="m.id === undoableId" class="link" :disabled="store.busy" @click="undo(m.id)">↶ Fortryd</button>
        <p v-if="m.undone" class="bubble-note">Fortrudt</p>
      </div>
    </div>

    <form class="chat-form" @submit.prevent="send()">
      <input v-model="text" maxlength="300" placeholder="Skriv en besked…" aria-label="Besked til rådgiveren" autocomplete="off" />
      <button class="primary" :disabled="store.busy || !text.trim()">Send</button>
    </form>
    <div class="chips">
      <button v-for="e in EXAMPLES" :key="e" type="button" class="chip" :disabled="store.busy" @click="send(e)">{{ e }}</button>
    </div>
  </section>
</template>
