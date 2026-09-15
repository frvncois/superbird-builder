import base from './vite.config'
import { mergeConfig } from 'vite'
export default mergeConfig(base, {
  server: { port: 5199, proxy: { '^(?!/admin(?:/|$))': { target: 'http://localhost:4199' } } },
})
