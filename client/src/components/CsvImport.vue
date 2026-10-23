<script setup>
import { ref, computed } from 'vue';
import { store, act, money, day } from '../store.js';
import { api } from '../api.js';

const emit = defineEmits(['done']);
const props = defineProps({ file: { type: File, required: true } });

const text = ref('');
const preview = ref(null);
const rows = ref([]);
const loading = ref(true);

// Older Danish bank exports are Windows-1252, not UTF-8; without this "Beløb" becomes "Bel�b".
async function readText(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function load(mapping) {
  loading.value = true;
  store.error = '';
  try {
    preview.value = await api.previewImport(text.value, mapping);
    // Rows you already have start unticked, so importing the same file twice adds nothing.
    rows.value = preview.value.rows.map((r) => ({ ...r, include: !r.duplicate, touched: false }));
  } catch (err) {
    store.error = err.message;
    if (!preview.value) emit('done');
  } finally {
    loading.value = false;
  }
}

async function start() {
  if (props.file.size > 4 * 1024 * 1024) {
    store.error = 'Filen er for stor (højst 4 MB)';
    return emit('done');
  }
  text.value = await readText(props.file);
  await load();
}
start();

const mapping = computed(() => preview.value?.mapping ?? { date: -1, amount: -1, text: -1 });
function remap(key, index) {
  load({ ...mapping.value, [key]: Number(index) });
}

// Fixing one row's category fixes the other rows with the same text that you haven't changed yourself.
function pick(row, category) {
  row.touched = true;
  for (const r of rows.value) if (!r.touched && r.note === row.note) r.category = category;
  row.category = category;
}

const chosen = computed(() => rows.value.filter((r) => r.include));
const total = computed(() => chosen.value.reduce((sum, r) => sum + r.amount, 0));
const unsure = computed(() => rows.value.filter((r) => r.include && !r.source && !r.touched).length);
const duplicates = computed(() => rows.value.filter((r) => r.duplicate).length);
const allOn = computed(() => rows.value.length > 0 && rows.value.every((r) => r.include));
const toggleAll = () => {
  const on = !allOn.value;
  rows.value.forEach((r) => (r.include = on));
};

const summary = computed(() => {
  const s = preview.value?.skipped ?? {};
  return [
    `${rows.value.length} udgifter fundet`,
    duplicates.value && `${duplicates.value} findes allerede`,
    s.income && `${s.income} indbetalinger springes over`,
    s.invalid && `${s.invalid} linjer kunne ikke læses`,
  ].filter(Boolean).join(' · ');
});

async function commit() {
  const payload = chosen.value.map(({ date, note, amount, category }) => ({ date, note, amount, category }));
  if (await act(api.importTransactions(payload))) emit('done', payload.length);
}
</script>

<template>
  <div class="import">
    <div class="import-head">
      <div>
        <h3>Importér fra CSV</h3>
        <p class="hint">{{ file.name }}<template v-if="preview"> · {{ summary }}</template></p>
      </div>
      <button class="link danger" @click="emit('done')">Annuller</button>
    </div>

    <p v-if="loading && !preview" class="muted">Læser filen…</p>

    <template v-if="preview">
      <div class="import-map">
        <label v-for="(label, key) in { date: 'Dato', amount: 'Beløb', text: 'Tekst' }" :key="key">
          {{ label }}-kolonne
          <select :value="mapping[key]" :disabled="loading" @change="remap(key, $event.target.value)">
            <option :value="-1" disabled>Vælg kolonne</option>
            <option v-for="(name, i) in preview.columns" :key="i" :value="i">{{ name }}</option>
          </select>
        </label>
      </div>

      <p v-if="!rows.length" class="muted">
        Ingen udgifter fundet. Tjek at kolonnerne ovenfor peger på dato og beløb.
      </p>

      <template v-else>
        <div class="import-bar">
          <label class="check"><input type="checkbox" :checked="allOn" @change="toggleAll" /> Vælg alle</label>
          <span v-if="unsure" class="hint">{{ unsure }} uden genkendt kategori, markeret med stiplet kant</span>
        </div>
        <ul class="import-rows">
          <li v-for="(r, i) in rows" :key="i" :class="{ off: !r.include }">
            <input v-model="r.include" type="checkbox" :aria-label="`Medtag ${r.note}`" />
            <span class="tx-date muted">{{ day(r.date) }}</span>
            <span class="tx-note" :title="r.note">{{ r.note || '–' }}<span v-if="r.duplicate" class="tag">findes allerede</span></span>
            <select
              :value="r.category"
              :class="{ unsure: !r.source && !r.touched }"
              :title="!r.source && !r.touched ? 'Ikke genkendt, tjek kategorien' : ''"
              aria-label="Kategori"
              @change="pick(r, $event.target.value)"
            >
              <option v-for="c in store.data.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <span class="tx-amount">{{ money(r.amount) }}</span>
          </li>
        </ul>
        <div class="actions">
          <button class="primary" :disabled="!chosen.length || store.busy || loading" @click="commit">
            Importér {{ chosen.length }} {{ chosen.length === 1 ? 'postering' : 'posteringer' }} ({{ money(total) }})
          </button>
        </div>
      </template>
    </template>
  </div>
</template>
