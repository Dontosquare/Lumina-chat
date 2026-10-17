import { createApp } from 'vue';
import App from './App.vue';
// Fonts are bundled with the app (no requests to Google), so it still works offline.
import '@fontsource-variable/comfortaa';
import '@fontsource-variable/montserrat';
import './styles.css';

createApp(App).mount('#app');
