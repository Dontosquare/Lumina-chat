<script setup>
import { ref } from 'vue';
import { store, act, money, month } from '../store.js';
import { api } from '../api.js';

const adding = ref(false);
const blank = () => ({ name: '', target: '', saved: 0, monthlyContribution: 0, deadline: '', priority: 2 });
const form = ref(blank());
const PRIORITY = { 1: 'Høj', 2: 'Mellem', 3: 'Lav' };

async function addGoal() {
  if (await act(api.addGoal(form.value))) {
    form.value = blank();
    adding.value = false;
  }
}

const pct = (g) => Math.min(100, Math.round((g.saved / g.target) * 100));
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>Mål</h2>
      <button class="ghost small" @click="adding = !adding">{{ adding ? 'Annullér' : '+ Nyt mål' }}</button>
    </header>

    <form v-if="adding" class="form-grid" @submit.prevent="addGoal">
      <label class="wide">Navn<input v-model="form.name" required placeholder="F.eks. ny computer" /></label>
      <label>Mål (kr.)<input v-model.number="form.target" type="number" min="1" required /></label>
      <label>Allerede sparet<input v-model.number="form.saved" type="number" min="0" /></label>
      <label>Pr. måned<input v-model.number="form.monthlyContribution" type="number" min="0" /></label>
      <label>Deadline<input v-model="form.deadline" type="date" required /></label>
      <label>Prioritet
        <select v-model.number="form.priority">
          <option :value="1">Høj</option><option :value="2">Mellem</option><option :value="3">Lav</option>
        </select>
      </label>
      <button class="primary" :disabled="store.busy">Tilføj mål</button>
    </form>

    <div class="goals">
      <article v-for="g in store.data.goals" :key="g.id" class="goal">
        <div class="goal-head">
          <h3>{{ g.name }}</h3>
          <span :class="['badge', g.onTrack ? 'good' : 'warn']">
            {{ g.onTrack ? 'På sporet' : `Mangler ${money(g.gap)}/md.` }}
          </span>
        </div>
        <div class="bar" :aria-label="`${pct(g)} % sparet`"><span :style="{ width: pct(g) + '%' }"></span></div>
        <p class="goal-numbers">
          <strong>{{ money(g.saved) }}</strong> af {{ money(g.target) }}
          <span class="muted">· {{ pct(g) }} %</span>
        </p>
        <dl class="facts">
          <div><dt>Sparer</dt><dd>{{ money(g.monthlyContribution) }}/md.</dd></div>
          <div><dt>Kræver</dt><dd>{{ money(g.required) }}/md.</dd></div>
          <div><dt>Deadline</dt><dd>{{ month(g.deadline.slice(0, 7)) }}</dd></div>
          <div><dt>I dette tempo</dt><dd :class="{ late: !g.onTrack }">{{ month(g.projected) }}</dd></div>
        </dl>
        <footer class="goal-foot">
          <span class="muted">{{ PRIORITY[g.priority] }} prioritet</span>
          <button class="link danger" @click="act(api.deleteGoal(g.id))">Fjern</button>
        </footer>
      </article>
      <p v-if="!store.data.goals.length" class="muted">Ingen mål endnu. Tilføj et, så rådgiveren ved, hvad du sigter efter.</p>
    </div>
  </section>
</template>
