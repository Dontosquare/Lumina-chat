<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { store, act, money } from '../store.js';
import { api } from '../api.js';

const mode = ref('balanced');
const focusGoalId = ref('');
const visible = ref(Infinity); // how many trace steps are revealed
const expanded = ref(new Set());
let timer;
let animatedRunId = null;

const run = computed(() => store.data.lastRun);
const steps = computed(() => run.value?.trace ?? []);
const thinking = computed(() => visible.value < steps.value.length);
const pending = computed(() => run.value?.suggestions.filter((s) => s.status === 'pending').length ?? 0);

const MODE_HINTS = {
  balanced: 'Bruger det meste af luften i budgettet og skærer lidt ned',
  saver: 'Flytter alt overskud og skærer i det, der ikke er nødvendigt',
  lifestyle: 'Flytter kun penge, du tydeligvis ikke bruger',
};

// Replay the agent's steps one by one so you can watch it reason.
watch(
  () => run.value?.id,
  (id) => {
    if (!id || id === animatedRunId) return;
    const fresh = animatedRunId !== null || Date.now() - Date.parse(run.value.createdAt) < 5000;
    animatedRunId = id;
    clearInterval(timer);
    if (!fresh) return;
    visible.value = 0;
    timer = setInterval(() => {
      visible.value++;
      if (visible.value >= steps.value.length) clearInterval(timer);
    }, 550);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));

function runAgent() {
  act(api.runAgent({ mode: mode.value, focusGoalId: focusGoalId.value || null }));
}

function badge(s) {
  if (s.type === 'advice') return { text: 'Råd', tone: 'warn' };
  if (s.type === 'extend_deadline') return { text: 'Gentænk mål', tone: 'neutral' };
  if (s.type === 'reduce') return s.target.kind === 'goal' ? { text: 'Mindre opsparing', tone: 'neutral' } : { text: 'Skær ned', tone: 'accent' };
  return s.target.kind === 'goal' ? { text: 'Finansiér mål', tone: 'accent' } : { text: 'Ret budget', tone: 'accent' };
}

function toggle(id) {
  const next = new Set(expanded.value);
  next.has(id) ? next.delete(id) : next.add(id);
  expanded.value = next;
}
</script>

<template>
  <section class="panel agent">
    <header class="panel-head">
      <div>
        <h2><span class="orb orb-sm" :class="{ pulse: thinking }"></span> Budgethjælper</h2>
        <p class="muted">Fortæl den, hvad der betyder noget for dig. Den læser dit forbrug og dine mål og foreslår ændringer. Intet ændres, før du accepterer.</p>
      </div>
    </header>

    <div class="intent">
      <span class="label">Din hensigt</span>
      <div class="chips" role="radiogroup" aria-label="Hensigt">
        <button
          v-for="(label, key) in store.data.modes"
          :key="key"
          role="radio"
          :aria-checked="mode === key"
          :class="['chip', { active: mode === key }]"
          @click="mode = key"
        >
          {{ label }}
        </button>
      </div>
      <p class="hint">{{ MODE_HINTS[mode] }}</p>

      <label class="label" for="focus">Fokusér på et mål</label>
      <select id="focus" v-model="focusGoalId">
        <option value="">Brug mine prioriteter</option>
        <option v-for="g in store.data.goals" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>

      <button class="primary" :disabled="store.busy || thinking" @click="runAgent">
        {{ thinking ? 'Tænker…' : run ? 'Kør igen' : 'Spørg budgethjælperen' }}
      </button>
    </div>

    <ol v-if="run" class="trace">
      <li v-for="s in steps.slice(0, visible)" :key="s.step" :class="{ final: !s.tool }">
        <p class="thought">{{ s.thought }}</p>
        <p v-if="s.tool" class="tool">
          <code>{{ s.tool }}</code>
          <span>{{ s.summary }}</span>
        </p>
      </li>
      <li v-if="thinking" class="typing" aria-label="Budgethjælperen tænker"><span></span><span></span><span></span></li>
    </ol>

    <div v-if="run && !thinking" class="suggestions">
      <h3>
        Forslag
        <span class="muted">{{ pending ? `${pending} venter på dig` : 'alle gennemgået' }}</span>
      </h3>
      <p v-if="!run.suggestions.length" class="muted">{{ run.emptyText || 'Der er ikke brug for ændringer lige nu.' }}</p>

      <article v-for="s in run.suggestions" :key="s.id" :class="['suggestion', s.status]">
        <div class="suggestion-top">
          <span :class="['badge', badge(s).tone]">{{ badge(s).text }}</span>
          <span v-if="s.confidence === 'medium'" class="badge warn" title="Kræver en lille ændring i dine vaner">kræver nye vaner</span>
        </div>
        <h4>{{ s.title }}</h4>
        <p class="impact">{{ s.impact }}</p>

        <ul v-if="s.moves" class="moves">
          <li v-for="m in s.moves" :key="m.label">
            <span>{{ m.label }}</span><strong>−{{ money(m.amount) }}</strong>
          </li>
        </ul>

        <template v-if="s.type === 'advice'">
          <p class="rationale">{{ s.rationale }}</p>
          <div v-if="s.status === 'pending'" class="actions">
            <button class="primary small" :disabled="store.busy" @click="act(api.dismiss(s.id))">Forstået</button>
          </div>
          <p v-else class="status">Forstået</p>
        </template>
        <template v-else>
          <button class="link" @click="toggle(s.id)">{{ expanded.has(s.id) ? 'Skjul begrundelse' : 'Hvorfor?' }}</button>
          <p v-if="expanded.has(s.id)" class="rationale">{{ s.rationale }}</p>

          <div v-if="s.status === 'pending'" class="actions">
            <button class="primary small" :disabled="store.busy" @click="act(api.apply(s.id))">Acceptér</button>
            <button class="ghost small" :disabled="store.busy" @click="act(api.dismiss(s.id))">Afvis</button>
          </div>
          <p v-else class="status">{{ s.status === 'applied' ? 'Accepteret' : 'Afvist' }}</p>
        </template>
      </article>
    </div>

    <div v-if="!run" class="empty">
      <p>Budgethjælperen har ikke kigget på din økonomi endnu.</p>
      <p class="muted">Vælg en hensigt og spørg den. Du kan se hvert skridt, den tager.</p>
    </div>
  </section>
</template>
