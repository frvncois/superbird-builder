import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

// The SPA is the admin editor only — it's served under /admin/ (Vite base),
// so route paths here are base-relative. The published site is the static
// export served by the node server at /; it never enters this router.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'build',
      component: () => import('@/views/BuildView.vue'),
    },
    { path: '/editor', redirect: '/' },
    {
      path: '/preview',
      name: 'preview',
      component: () => import('@/views/PreviewView.vue'),
      meta: { title: 'Preview — Guano' },
    },
    { path: '/content', redirect: '/preview' },
    {
      path: '/invite/:token',
      name: 'invite',
      component: () => import('@/views/SetPasswordView.vue'),
      meta: { title: 'Join — Guano' },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: 'Log in — Guano' },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/views/SetupView.vue'),
      meta: { title: 'Set up — Guano' },
    },
    // any stray /admin/* URL falls back to the editor (which auth-gates)
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  await auth.check()
  const authed = !!auth.email.value
  if ((to.name === 'build' || to.name === 'preview') && !authed) {
    return auth.needsSetup.value ? '/setup' : '/login'
  }
  // contributors are preview-only — keep them out of the build view
  if (to.name === 'build' && authed && auth.role.value === 'contributor') {
    return '/preview'
  }
  if ((to.name === 'login' || to.name === 'setup') && authed) return '/'
  if (to.name === 'login' && auth.needsSetup.value) return '/setup'
  if (to.name === 'setup' && !auth.needsSetup.value && !authed) return '/login'
  return true
})

// per-view tab titles; the build view (no meta) keeps the plain product name
router.afterEach((to) => {
  document.title = (to.meta.title as string | undefined) ?? 'Guano'
})

export default router
