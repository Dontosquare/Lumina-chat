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
      <span class="label">Månedlig indkomst</span>
      <form v-if="editing" @submit.prevent="saveIncome">
        <input ref="input" v-model.number="draft" type="number" min="0" class="stat-input" @blur="saveIncome" />
      </form>
      <button v-else class="stat-value editable" title="Ret indkomst" @click="edit">{{ money(store.data.income) }}</button>
    </div>
    <div class="stat">
      <span class="label">Budgetteret forbrug</span>
      <span class="stat-value">{{ money(store.data.budgeted) }}</span>
      <span class="hint">{{ money(store.data.spentThisMonth) }} brugt denne måned</span>
    </div>
    <div class="stat">
      <span class="label">Til mål</span>
      <span class="stat-value">{{ money(store.data.saving) }}</span>
      <span class="hint">{{ store.data.income ? Math.round((store.data.saving / store.data.income) * 100) : 0 }} % opsparingsrate</span>
    </div>
    <div class="stat" :class="{ highlight: store.data.unallocated > 0, negative: store.data.unallocated < 0 }">
      <span class="label">{{ store.data.unallocated < 0 ? 'Underskud' : 'Ufordelt' }}</span>
      <span class="stat-value">{{ money(store.data.unallocated) }}</span>
      <span class="hint">{{ store.data.unallocated < 0 ? 'Du har planlagt mere, end du tjener. Spørg budgethjælperen' : 'Penge uden en opgave endnu' }}</span>
    </div>
  </section>
</template>
