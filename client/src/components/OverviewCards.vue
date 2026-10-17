<script setup>
import { ref, nextTick } from 'vue';
import { store, act, money } from '../store.js';
import { api } from '../api.js';

const editing = ref(false);
const draft = ref(0);
const input = ref(null);

async function edit() {
  draft.value = store.data.income;
  editing.value = true;
  await nextTick();
  input.value?.select();
}

async function saveIncome() {
  if (!editing.value) return;
  editing.value = false;
  if (Number(draft.value) !== store.data.income) await act(api.setIncome(draft.value));
}
</script>

<template>
  <section class="overview">
    <div class="stat">
      <span class="label">Monthly income</span>
      <form v-if="editing" @submit.prevent="saveIncome">
        <input ref="input" v-model.number="draft" type="number" min="0" class="stat-input" @blur="saveIncome" />
      </form>
      <button v-else class="stat-value editable" title="Edit income" @click="edit">{{ money(store.data.income) }}</button>
    </div>
    <div class="stat">
      <span class="label">Budgeted spending</span>
      <span class="stat-value">{{ money(store.data.budgeted) }}</span>
      <span class="hint">{{ money(store.data.spentThisMonth) }} spent this month</span>
    </div>
    <div class="stat">
      <span class="label">Going to goals</span>
      <span class="stat-value">{{ money(store.data.saving) }}</span>
      <span class="hint">{{ Math.round((store.data.saving / store.data.income) * 100) }}% savings rate</span>
    </div>
    <div class="stat" :class="{ highlight: store.data.unallocated > 0, negative: store.data.unallocated < 0 }">
      <span class="label">Unassigned</span>
      <span class="stat-value">{{ money(store.data.unallocated) }}</span>
      <span class="hint">{{ store.data.unallocated < 0 ? 'You\'ve planned more than you earn' : 'Money with no job yet' }}</span>
    </div>
  </section>
</template>
