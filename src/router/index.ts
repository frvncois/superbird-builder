import { createRouter, createWebHistory, START_LOCATION } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/admin',
      name: 'editor',
      component: () => import('@/views/BuildView.vue'),
    },
    { path: '/admin/editor', redirect: '/admin' },
    {
      path: '/admin/content',
      name: 'content',
      component: () => import('@/views/ContentView.vue'),
    },
    {
      path: '/admin/invite/:token',
      name: 'invite',
      component: () => import('@/views/SetPasswordView.vue'),
    },
    {
      path: '/admin/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/admin/setup',
      name: 'setup',
      component: () => import('@/views/SetupView.vue'),
    },
    // public catch-all — everything that isn't /admin is the published site
    {
      path: '/:pathMatch(.*)*',
      name: 'site',
      component: () => import('@/views/SiteView.vue'),
    },
  ],
})

/** admin and the public site are separate boots: crossing zones is a full
 * page load, so editor singletons (autosave watcher, keymaps, the working
 * project) never coexist with the published snapshot */
const zoneOf = (path: string) => (path.startsWith('/admin') ? 'admin' : 'site')

router.beforeEach(async (to, from) => {
  if (from !== START_LOCATION && zoneOf(from.path) !== zoneOf(to.path)) {
    window.location.assign(to.fullPath)
    return false
  }

  // auth gate — admin zone only; the public site never triggers auth fetches
  if (zoneOf(to.path) !== 'admin') return true
  const auth = useAuth()
  await auth.check()
  const authed = !!auth.email.value
  if ((to.name === 'editor' || to.name === 'content') && !authed) {
    return auth.needsSetup.value ? '/admin/setup' : '/admin/login'
  }
  // contributors are content-only — keep them out of the build view
  if (to.name === 'editor' && authed && auth.role.value === 'contributor') {
    return '/admin/content'
  }
  if ((to.name === 'login' || to.name === 'setup') && authed) return '/admin'
  if (to.name === 'login' && auth.needsSetup.value) return '/admin/setup'
  if (to.name === 'setup' && !auth.needsSetup.value && !authed) return '/admin/login'
  return true
})

export default router
