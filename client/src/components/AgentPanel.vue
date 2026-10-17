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
  balanced: 'Use most of the slack, small trims',
  saver: 'Move everything spare, trim wants',
  lifestyle: 'Only move money you clearly don\'t use',
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
        <h2><span class="orb small" :class="{ pulse: thinking }"></span> Budget agent</h2>
        <p class="muted">Tell it what matters. It reads your spending and goals, then proposes moves. Nothing changes until you accept.</p>
      </div>
    </header>

    <div class="intent">
      <span class="label">Your intent</span>
      <div class="chips" role="radiogroup" aria-label="Intent">
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

      <label class="label" for="focus">Focus on a goal</label>
      <select id="focus" v-model="focusGoalId">
        <option value="">Use my priorities</option>
        <option v-for="g in store.data.goals" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>

      <button class="primary" :disabled="store.busy || thinking" @click="runAgent">
        {{ thinking ? 'Thinking…' : run ? 'Run again' : 'Ask the agent' }}
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
      <li v-if="thinking" class="typing" aria-label="Agent is thinking"><span></span><span></span><span></span></li>
    </ol>

    <div v-if="run && !thinking" class="suggestions">
      <h3>
        Suggestions
        <span class="muted">{{ pending ? `${pending} waiting for you` : 'all reviewed' }}</span>
      </h3>
      <p v-if="!run.suggestions.length" class="muted">No changes needed right now.</p>

      <article v-for="s in run.suggestions" :key="s.id" :class="['suggestion', s.status]">
        <div class="suggestion-top">
          <span :class="['badge', s.type === 'extend_deadline' ? 'neutral' : 'accent']">
            {{ s.type === 'extend_deadline' ? 'Rethink goal' : s.target.kind === 'goal' ? 'Fund goal' : 'Fix budget' }}
          </span>
          <span v-if="s.confidence === 'medium'" class="badge warn" title="Needs a small change in spending habits">needs a habit change</span>
        </div>
        <h4>{{ s.title }}</h4>
        <p class="impact">→ {{ s.impact }}</p>

        <ul v-if="s.moves" class="moves">
          <li v-for="m in s.moves" :key="m.label">
            <span>{{ m.label }}</span><strong>−{{ money(m.amount) }}</strong>
          </li>
        </ul>

        <button class="link" @click="toggle(s.id)">{{ expanded.has(s.id) ? 'Hide reasoning' : 'Why?' }}</button>
        <p v-if="expanded.has(s.id)" class="rationale">{{ s.rationale }}</p>

        <div v-if="s.status === 'pending'" class="actions">
          <button class="primary small" :disabled="store.busy" @click="act(api.apply(s.id))">Accept</button>
          <button class="ghost small" :disabled="store.busy" @click="act(api.dismiss(s.id))">Dismiss</button>
        </div>
        <p v-else class="status">{{ s.status === 'applied' ? '✓ Applied' : 'Dismissed' }}</p>
      </article>
    </div>

    <div v-if="!run" class="empty">
      <p>The agent hasn't looked at your money yet.</p>
      <p class="muted">Pick an intent and ask it. You'll see every step it takes.</p>
    </div>
  </section>
</template>
