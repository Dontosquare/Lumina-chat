<script setup>
import { ref, nextTick } from 'vue';
import { store, act, money } from '../store.js';
import { api } from '../api.js';

const KIND = { essential: 'nødvendig', discretionary: 'valgfri' };
const STEP = 50;

// ---- "Hvad er det?" explanations, keyed by budget id
const ABOUT = {
  housing: 'Husleje eller boligydelse, fællesudgifter og ejendomsskat. Det er typisk din største faste udgift. En tommelfingerregel er, at boligen højst bør koste omkring en tredjedel af din indkomst efter skat.',
  groceries: 'Mad og husholdningsvarer fra supermarked, bager og torvehal. Posten kan styres ret godt med en madplan og en indkøbsliste.',
  utilities: 'El, vand, varme og internet. Udgiften svinger med årstiderne, så kig på gennemsnittet over flere måneder i stedet for én enkelt regning.',
  transport: 'Rejsekort, månedskort, benzin, parkering, taxa og vedligeholdelse af bil eller cykel.',
  dining: 'Restaurantbesøg, takeaway, kaffe ude og frokost på farten. Det er en af de nemmeste poster at skære i, hvis du mangler penge.',
  shopping: 'Tøj, sko, elektronik, boligindretning og andre ting, du køber, som ikke er dagligvarer.',
  entertainment: 'Biograf, koncerter, sport, hobbyer og andre oplevelser.',
  subscriptions: 'Faste månedlige betalinger som streaming, musik, fitness og cloudlager. Gennemgå dem jævnligt, for de er lette at glemme.',
  travel: 'Ferier, weekendture, fly, tog og hotel. Det kan betale sig at spare lidt op hver måned i stedet for at betale det hele på én gang.',
};
const KIND_ABOUT = {
  essential: 'Nødvendig udgift: rådgiveren skærer aldrig her under det, du faktisk bruger.',
  discretionary: 'Valgfri udgift: her kan rådgiveren foreslå, at du bruger mindre.',
};
// Shown with pure CSS on hover or keyboard focus (tap on phones), so no state is needed here.

// ---- dragging the limit line. While dragging, the bar's scale is frozen so the line follows the mouse exactly.
const drag = ref(null); // { id, value, scale, track }

const scaleOf = (c) => (drag.value?.id === c.id ? drag.value.scale : Math.max(c.monthly, c.projected, c.avgMonthly, 100) * 1.25);
const limitOf = (c) => (drag.value?.id === c.id ? drag.value.value : c.monthly);
const pct = (v, c) => Math.min(100, (v / scaleOf(c)) * 100);

function startDrag(e, c) {
  if (drag.value?.saving) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.focus();
  drag.value = { id: c.id, value: c.monthly, scale: scaleOf(c), track: e.currentTarget.parentElement };
}

function moveDrag(e) {
  const d = drag.value;
  if (!d || d.saving || !d.track) return;
  const r = d.track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  d.value = Math.round((ratio * d.scale) / STEP) * STEP;
}

async function commit(c) {
  const d = drag.value;
  if (!d || d.id !== c.id || d.saving) return;
  if (d.value === c.monthly) {
    drag.value = null;
    return;
  }
  d.saving = true; // keep showing the new value until the server confirms
  await act(api.setBudget(c.id, d.value));
  drag.value = null;
}

function nudge(e, c) {
  const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!delta || drag.value?.saving) return;
  e.preventDefault();
  if (drag.value?.id !== c.id) drag.value = { id: c.id, value: c.monthly, scale: scaleOf(c), track: null };
  drag.value.value = Math.max(0, drag.value.value + delta * (e.shiftKey ? 10 : 1) * STEP);
}

// ---- typing an amount directly
const editingId = ref(null);
const draft = ref(0);
const inputs = ref({});

async function edit(c) {
  editingId.value = c.id;
  draft.value = c.monthly;
  await nextTick();
  inputs.value[c.id]?.select();
}

async function save(c) {
  if (editingId.value !== c.id) return;
  editingId.value = null;
  if (draft.value !== '' && Number(draft.value) !== c.monthly) await act(api.setBudget(c.id, draft.value));
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <div>
        <h2>Budgetter</h2>
        <p class="muted">Træk i budgetlinjen, eller klik på beløbet for at skrive det.</p>
      </div>
      <p class="legend muted">
        <span class="key spent"></span>brugt indtil nu
        <span class="key avg"></span>gns. 3 måneder
        <span class="key line"></span>budget
      </p>
    </header>
    <ul class="budgets">
      <li v-for="c in store.data.categories" :key="c.id" :class="['budget', { flash: store.flash.has(c.id) }]">
        <div class="budget-head">
          <span class="name">
            {{ c.name }}
            <span class="info">
              <button type="button" class="info-btn" :aria-describedby="`about-${c.id}`">Hvad er det?</button>
              <span :id="`about-${c.id}`" role="tooltip" class="info-tip">
                <span>{{ ABOUT[c.id] ?? 'Der er ingen beskrivelse af dette budget endnu.' }}</span>
                <span class="info-kind">{{ KIND_ABOUT[c.kind] }}</span>
              </span>
            </span>
            <span class="tag">{{ KIND[c.kind] }}</span>
          </span>
          <span class="nums">
            <strong>{{ money(c.monthToDate) }}</strong>
            <span class="muted"> / </span>
            <form v-if="editingId === c.id" class="budget-edit" @submit.prevent="save(c)">
              <input
                :ref="(el) => (inputs[c.id] = el)"
                v-model.number="draft"
                type="number"
                min="0"
                step="50"
                :aria-label="`Budget for ${c.name}`"
                @blur="save(c)"
                @keydown.esc="editingId = null"
              />
              <span class="muted">kr.</span>
            </form>
            <button
              v-else
              :class="['budget-amount', { live: drag?.id === c.id }]"
              :title="`Ret budget for ${c.name}`"
              @click="edit(c)"
            >
              {{ money(limitOf(c)) }} <span aria-hidden="true">✎</span>
            </button>
          </span>
        </div>
        <div class="track">
          <span class="fill" :class="{ over: c.projected > limitOf(c) }" :style="{ width: pct(c.monthToDate, c) + '%' }"></span>
          <span class="avg" :style="{ left: pct(c.avgMonthly, c) + '%' }" :title="`Gennemsnit ${money(c.avgMonthly)}`"></span>
          <span
            :class="['limit', { dragging: drag?.id === c.id }]"
            :style="{ left: pct(limitOf(c), c) + '%' }"
            role="slider"
            tabindex="0"
            :aria-label="`Budget for ${c.name}`"
            aria-valuemin="0"
            :aria-valuenow="limitOf(c)"
            :aria-valuetext="money(limitOf(c))"
            :title="`Træk for at ændre budgettet (${money(limitOf(c))})`"
            @pointerdown="startDrag($event, c)"
            @pointermove="moveDrag"
            @pointerup="commit(c)"
            @pointercancel="commit(c)"
            @keydown="nudge($event, c)"
            @keyup="commit(c)"
            @blur="commit(c)"
          ></span>
        </div>
        <p class="hint">
          Normalt {{ money(c.avgMonthly) }}/md.
          <template v-if="c.avgMonthly > limitOf(c) * 1.03"> · <span class="late">går over budget</span></template>
          <template v-else-if="limitOf(c) - c.avgMonthly >= 100"> · {{ money(limitOf(c) - c.avgMonthly) }} ubrugt</template>
        </p>
      </li>
    </ul>
  </section>
</template>
