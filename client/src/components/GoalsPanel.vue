<script setup>
import { ref } from 'vue';
import { store, act, money, month } from '../store.js';
import { api } from '../api.js';

const adding = ref(false);
const blank = () => ({ name: '', target: '', saved: 0, monthlyContribution: 0, deadline: '', priority: 2 });
const form = ref(blank());
const PRIORITY = { 1: 'High', 2: 'Medium', 3: 'Low' };

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
      <h2>Goals</h2>
      <button class="ghost small" @click="adding = !adding">{{ adding ? 'Cancel' : '+ New goal' }}</button>
    </header>

    <form v-if="adding" class="form-grid" @submit.prevent="addGoal">
      <label class="wide">Name<input v-model="form.name" required placeholder="e.g. New laptop" /></label>
      <label>Target<input v-model.number="form.target" type="number" min="1" required /></label>
      <label>Already saved<input v-model.number="form.saved" type="number" min="0" /></label>
      <label>Per month<input v-model.number="form.monthlyContribution" type="number" min="0" /></label>
      <label>Deadline<input v-model="form.deadline" type="date" required /></label>
      <label>Priority
        <select v-model.number="form.priority">
          <option :value="1">High</option><option :value="2">Medium</option><option :value="3">Low</option>
        </select>
      </label>
      <button class="primary" :disabled="store.busy">Add goal</button>
    </form>

    <div class="goals">
      <article v-for="g in store.data.goals" :key="g.id" class="goal">
        <div class="goal-head">
          <h3>{{ g.name }}</h3>
          <span :class="['badge', g.onTrack ? 'good' : 'warn']">
            {{ g.onTrack ? 'On track' : `Short ${money(g.gap)}/mo` }}
          </span>
        </div>
        <div class="bar" :aria-label="`${pct(g)}% saved`"><span :style="{ width: pct(g) + '%' }"></span></div>
        <p class="goal-numbers">
          <strong>{{ money(g.saved) }}</strong> of {{ money(g.target) }}
          <span class="muted">· {{ pct(g) }}%</span>
        </p>
        <dl class="facts">
          <div><dt>Saving</dt><dd>{{ money(g.monthlyContribution) }}/mo</dd></div>
          <div><dt>Needs</dt><dd>{{ money(g.required) }}/mo</dd></div>
          <div><dt>Deadline</dt><dd>{{ month(g.deadline.slice(0, 7)) }}</dd></div>
          <div><dt>At this pace</dt><dd :class="{ late: !g.onTrack }">{{ month(g.projected) }}</dd></div>
        </dl>
        <footer class="goal-foot">
          <span class="muted">{{ PRIORITY[g.priority] }} priority</span>
          <button class="link danger" @click="act(api.deleteGoal(g.id))">Remove</button>
        </footer>
      </article>
      <p v-if="!store.data.goals.length" class="muted">No goals yet. Add one so the agent knows what you're aiming for.</p>
    </div>
  </section>
</template>
