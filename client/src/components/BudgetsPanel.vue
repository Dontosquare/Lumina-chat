<script setup>
import { store, money } from '../store.js';

const scale = (c) => Math.max(c.monthly, c.projected, c.avgMonthly) || 1;
const pct = (v, c) => Math.min(100, (v / scale(c)) * 100);
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>Budgets</h2>
      <p class="legend muted">
        <span class="key spent"></span>spent so far
        <span class="key avg"></span>3-month avg
        <span class="key line"></span>budget
      </p>
    </header>
    <ul class="budgets">
      <li v-for="c in store.data.categories" :key="c.id" class="budget">
        <div class="budget-head">
          <span class="name">{{ c.name }} <span class="tag">{{ c.kind }}</span></span>
          <span class="nums">
            <strong>{{ money(c.monthToDate) }}</strong>
            <span class="muted"> / {{ money(c.monthly) }}</span>
          </span>
        </div>
        <div class="track">
          <span class="fill" :class="{ over: c.projected > c.monthly }" :style="{ width: pct(c.monthToDate, c) + '%' }"></span>
          <span class="avg" :style="{ left: pct(c.avgMonthly, c) + '%' }" :title="`Average ${money(c.avgMonthly)}`"></span>
          <span class="limit" :style="{ left: pct(c.monthly, c) + '%' }"></span>
        </div>
        <p class="hint">
          Usually {{ money(c.avgMonthly) }}/mo
          <template v-if="c.avgMonthly > c.monthly * 1.03"> · <span class="late">runs over</span></template>
          <template v-else-if="c.monthly - c.avgMonthly >= 100"> · {{ money(c.monthly - c.avgMonthly) }} unused</template>
        </p>
      </li>
    </ul>
  </section>
</template>
