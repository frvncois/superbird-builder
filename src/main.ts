import './assets/main.css'

import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { tooltip } from './directives/tooltip'

const app = createApp(App)

app.use(router)
app.directive('tooltip', tooltip)

app.mount('#app')
