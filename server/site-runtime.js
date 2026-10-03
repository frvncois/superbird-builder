// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// Guano static-site runtime (~4 KB): interactions.
//
// Interactions replay the editor's triggers by toggling Tailwind classes.
// Semantics mirror src/composables/useInteraction.ts + useRenderNode.ts; key
// identity mirrors src/lib/shared/interactionKeys.js.
//
// STATE IS KEYED BY EFFECT, NOT BY TRIGGER. A state key is
// `interactionId:targetId[@scope]`, so an "open" button, a "close" button and an
// overlay all drive ONE boolean. Keyed by binding id (as this used to be), each
// trigger flipped its own independent flag — so a close button could never undo
// what an open button did, and the to-classes were applied twice. That is what
// made modals unbuildable.
//
// Each [data-tgt] element's class list is fully recomputed from its captured
// base + the toClasses of every fired state targeting it (never token
// add/remove — shared tokens would clobber).
;(function () {
  // ---------- interactions ----------
  var fxEl = document.getElementById('int-fx')
  if (!fxEl) return

  var fx = JSON.parse(fxEl.textContent || '{}')
  var fired = new Set()
  var noanim = /[?&]noanim\b/.test(location.search)

  // breakpoint-scoped interactions: width→breakpoint map + per-state scope.
  // Absent when nothing is scoped, so gating is a no-op then.
  var bpEl = document.getElementById('int-bp')
  var bps = bpEl ? JSON.parse(bpEl.textContent || '[]') : []
  bps.sort(function (a, b) {
    return a.w - b.w
  })
  var fxbpEl = document.getElementById('int-fxbp')
  var fxbp = fxbpEl ? JSON.parse(fxbpEl.textContent || '{}') : {}

  // state key → base classes to REMOVE from the target while fired
  // (same-property conflicts precomputed at export: hidden+flex etc. —
  // without this the cascade picks an arbitrary winner and toggles break)
  var rmEl = document.getElementById('int-fxrm')
  var fxrm = rmEl ? JSON.parse(rmEl.textContent || '{}') : {}

  // current breakpoint id for the viewport (mirrors breakpointIdForWidth in
  // src/lib/responsive.ts): tightest bp still covering this width, else widest
  var curBp = ''
  var computeBp = function () {
    if (!bps.length) return ''
    // documentElement.clientWidth, NOT innerWidth: any horizontal overflow
    // inflates innerWidth past the CSS viewport, so a mobile-scoped binding
    // went inert while Tailwind's md: CSS still showed its trigger
    var w = document.documentElement.clientWidth || window.innerWidth
    for (var i = 0; i < bps.length; i++) if (w <= bps[i].w) return bps[i].id
    return bps[bps.length - 1].id
  }
  var allowed = function (k) {
    var set = fxbp[k]
    return !set || set.indexOf(curBp) !== -1
  }

  var targets = []
  document.querySelectorAll('[data-tgt]').forEach(function (el) {
    targets.push({
      el: el,
      base: el.className.split(/\s+/).filter(Boolean),
      keys: el.getAttribute('data-tgt').split(' '),
    })
  })

  var apply = function () {
    curBp = computeBp()
    targets.forEach(function (t) {
      var extra = ''
      var rm = null
      t.keys.forEach(function (k) {
        if (fired.has(k) && fx[k] && allowed(k)) {
          extra += ' ' + fx[k]
          if (fxrm[k]) {
            rm = rm || {}
            fxrm[k].split(' ').forEach(function (c) {
              rm[c] = 1
            })
          }
        }
      })
      var base = rm
        ? t.base.filter(function (c) {
            return !rm[c]
          })
        : t.base
      t.el.className = base.join(' ') + extra
    })
  }

  // resize can move the viewport across breakpoints — re-gate applied classes
  if (Object.keys(fxbp).length) {
    var fxPending = null
    window.addEventListener('resize', function () {
      clearTimeout(fxPending)
      fxPending = setTimeout(apply, 100)
    })
  }

  // ---------- state, groups, dismissal, persistence ----------

  // group key → the one state key currently open in that exclusive group
  var openGroups = {}
  // state keys currently open AND dismissable (value = the closeOn modes)
  var dismissable = {}
  // state key → elements that count as "inside" it (its triggers + its targets)
  var insideEls = {}

  // Per-EFFECT options, collected from every binding that drives a state key.
  // These belong to the effect, not to the trigger that happens to declare
  // them: a close button can carry `closeOn`, and an overlay can carry the
  // group, while the effect they drive is the same one an open button fires.
  // Reading them off the firing trigger's own meta meant a dismissal declared on
  // an `action: "off"` button was never armed — that button never turns the
  // effect ON, which is when dismissal has to be registered.
  var closeOnFor = {} // state key → array of modes
  var groupFor = {} // state key → group key
  var onceFor = {} // state key → 'session' | 'local'

  var collectOptions = function (i) {
    if (i.c && i.c.length) {
      var into = closeOnFor[i.s] || (closeOnFor[i.s] = [])
      for (var n = 0; n < i.c.length; n++) {
        if (into.indexOf(i.c[n]) === -1) into.push(i.c[n])
      }
    }
    if (i.g && !groupFor[i.s]) groupFor[i.s] = i.g
    if (i.o && !onceFor[i.s]) onceFor[i.s] = i.o
  }

  var addInside = function (key, el) {
    ;(insideEls[key] = insideEls[key] || []).push(el)
  }

  // `once`: remember a state so a dismissal sticks. Published site only — the
  // editor always shows the element so it stays authorable.
  var storageFor = function (where) {
    try {
      return where === 'local' ? window.localStorage : window.sessionStorage
    } catch (e) {
      return null // private mode / blocked storage — degrade to not remembering
    }
  }
  var remember = function (where, key, on) {
    var store = storageFor(where)
    if (store) {
      try {
        store.setItem('guano-int:' + key, on ? '1' : '0')
      } catch (e) {
        /* quota — nothing to do */
      }
    }
  }
  var recall = function (where, key) {
    var store = storageFor(where)
    if (!store) return null
    try {
      var v = store.getItem('guano-int:' + key)
      return v === null ? null : v === '1'
    } catch (e) {
      return null
    }
  }

  var set = function (key, on) {
    // bookkeeping runs even when the state is unchanged (a second trigger
    // pointing at an already-open effect still has to register its dismissal
    // and claim its group slot); only the class recompute is skipped
    var changed = on !== fired.has(key)
    if (on) fired.add(key)
    else fired.delete(key)

    var group = groupFor[key]
    if (group) {
      if (on) {
        var open = openGroups[group]
        if (open && open !== key) {
          // exclusive group: close whatever else is open in it
          fired.delete(open)
          delete dismissable[open]
        }
        openGroups[group] = key
      } else if (openGroups[group] === key) {
        delete openGroups[group]
      }
    }

    var modes = closeOnFor[key]
    if (modes) {
      if (on) {
        dismissable[key] = modes
        installDismiss()
      } else {
        delete dismissable[key]
      }
    }

    if (onceFor[key] && changed) remember(onceFor[key], key, on)
    if (changed) apply()
  }

  // --- outside-click / Escape dismissal: one pair of capture-phase listeners,
  // installed the first time a dismissable effect opens ---
  var dismissInstalled = false
  var closeKey = function (key) {
    delete dismissable[key]
    fired.delete(key)
    var group = groupFor[key]
    if (group && openGroups[group] === key) delete openGroups[group]
    if (onceFor[key]) remember(onceFor[key], key, false)
    apply()
  }
  var installDismiss = function () {
    if (dismissInstalled) return
    dismissInstalled = true
    document.addEventListener(
      'pointerdown',
      function (e) {
        Object.keys(dismissable).forEach(function (key) {
          if (dismissable[key].indexOf('outside') === -1) return
          var els = insideEls[key] || []
          for (var i = 0; i < els.length; i++) {
            if (els[i].contains(e.target)) return // inside the menu/trigger
          }
          closeKey(key)
        })
      },
      true,
    )
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key !== 'Escape') return
        Object.keys(dismissable).forEach(function (key) {
          if (dismissable[key].indexOf('escape') !== -1) closeKey(key)
        })
      },
      true,
    )
  }

  // every target element counts as "inside" its own state keys, so clicking
  // within an open menu doesn't dismiss it
  targets.forEach(function (t) {
    t.keys.forEach(function (k) {
      addInside(k, t.el)
    })
  })

  // ---------- triggers ----------

  var appear = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return
      appear.unobserve(entry.target)
      JSON.parse(entry.target.getAttribute('data-int')).forEach(function (i) {
        if (i.t === 'appear') set(i.s, true) // fire once, never unfires
      })
    })
  })

  var appearMetas = []
  var scrolledMetas = []
  var triggers = []

  // PASS 1 — collect every trigger and fold its per-effect options together.
  // Options have to be known for ALL bindings before any of them fires, or a
  // `closeOn`/`group`/`once` declared on one trigger would be invisible to the
  // effect when a different trigger opens it.
  document.querySelectorAll('[data-int]').forEach(function (el) {
    JSON.parse(el.getAttribute('data-int')).forEach(function (i) {
      addInside(i.s, el)
      collectOptions(i)
      triggers.push({ el: el, i: i })
    })
  })

  // PASS 2 — restore remembered states, then wire the listeners. Restoring first
  // means a dismissed popup never flashes open.
  Object.keys(onceFor).forEach(function (key) {
    var was = recall(onceFor[key], key)
    if (was !== null) set(key, was)
  })

  triggers.forEach(function (entry) {
    var el = entry.el
    var i = entry.i
    if (i.t === 'hover') {
      el.addEventListener('mouseenter', function () {
        set(i.s, true)
      })
      el.addEventListener('mouseleave', function () {
        set(i.s, false)
      })
    } else if (i.t === 'click') {
      el.addEventListener('click', function () {
        // action: 'on' / 'off' force a direction, otherwise toggle. This plus
        // the shared state key is what makes open/close button pairs work.
        set(i.s, i.a === 'on' ? true : i.a === 'off' ? false : !fired.has(i.s))
      })
    } else if (i.t === 'appear') {
      appearMetas.push(i)
      appear.observe(el)
    } else if (i.t === 'scrolled') {
      scrolledMetas.push(i)
    } else if (i.t === 'change') {
      var onChange = function (e) {
        var t = e.target
        set(i.s, t.type === 'checkbox' || t.type === 'radio' ? t.checked : !!t.value)
      }
      el.addEventListener('change', onChange)
      el.addEventListener('input', onChange)
    }
  })

  // 'scrolled': on while the page is scrolled past the threshold — header
  // shrink, back-to-top reveal, sticky-bar states
  if (scrolledMetas.length) {
    var onScroll = function () {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0
      scrolledMetas.forEach(function (i) {
        set(i.s, y > (i.at || 50))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  // safety net: appear content starts at its base state (often opacity-0).
  // The observer reveals it on scroll, but if the element never intersects
  // (hidden tab, print, prerender, a crawler that ignores IO) it would stay
  // invisible. Force every appear state on with ?noanim, and otherwise after a
  // 3s fallback timeout — content is in the DOM either way, this only
  // guarantees it actually renders (and makes screenshots deterministic).
  var revealAll = function () {
    appearMetas.forEach(function (i) {
      set(i.s, true)
    })
  }
  if (noanim) revealAll()
  else if (appearMetas.length) setTimeout(revealAll, 3000)

  apply()
})()

// ---------- forms ----------
//
// Its own IIFE: the interactions block above returns early when a page has no
// `#int-fx`, and a page can carry a form with no interactions at all.
//
// PROGRESSIVE ENHANCEMENT is the point. The markup already posts natively, so
// a visitor without JS gets a real submission and a 303 back to the site with
// `?form=sent`. This block upgrades that to a fetch, so the page does not
// reload and the values survive an error.
;(function () {
  var forms = document.querySelectorAll('form[data-form]')
  var landed = /[?&]form=sent\b/.test(location.search)
  if (!forms.length) return

  // how long the visitor had the page open when they submitted. A bot that
  // posts the instant it parses the HTML trips the server's minimum; a
  // constant embedded token could not tell the two apart, because a static
  // page can only ever carry a constant.
  var openedAt = Date.now()

  var show = function (form, which) {
    var block = form.querySelector('[data-form-' + which + ']')
    if (block) block.hidden = false
    return block
  }
  var hideFields = function (form) {
    // everything except the state blocks: the visitor has submitted, so the
    // fields are no longer the thing on screen
    var kids = form.children
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i]
      if (!kid.hasAttribute('data-form-success') && !kid.hasAttribute('data-form-error')) {
        kid.hidden = true
      }
    }
  }

  Array.prototype.forEach.call(forms, function (form) {
    // a native post that already succeeded comes back as ?form=sent, so the
    // visitor lands on the SITE rather than on a bare JSON response
    if (landed) {
      hideFields(form)
      show(form, 'success')
    }

    form.addEventListener('submit', function (e) {
      if (!window.fetch || !window.FormData) return // let the native post run
      e.preventDefault()
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return

      var button = form.querySelector('button[type=submit], button:not([type]), input[type=submit]')
      if (button) button.disabled = true
      var errorBlock = form.querySelector('[data-form-error]')
      if (errorBlock) errorBlock.hidden = true

      var body = new URLSearchParams(new FormData(form))
      body.set('_t', String(Date.now() - openedAt))

      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        // no cookie is needed or wanted: the endpoint is public, and sending
        // credentials cross-origin is how a public route becomes a CSRF hole
        credentials: 'omit',
        mode: 'cors',
      })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { ok: res.ok, status: res.status, data: data }
            },
            function () {
              return { ok: res.ok, status: res.status, data: {} }
            },
          )
        })
        .then(function (r) {
          if (button) button.disabled = false
          if (r.ok && r.data && r.data.ok) {
            // Only ever a ROOT-RELATIVE path. The exporter validates this as an
            // internal route too, but this runtime is served from static hosts
            // we do not control, so it does not trust its own markup: a
            // `javascript:` value would execute here, and an absolute one is an
            // open redirect off the back of a successful submission.
            var to = form.getAttribute('data-form-redirect')
            if (to && to.charAt(0) === '/' && to.charAt(1) !== '/' && to.indexOf('\\') === -1) {
              location.assign(to)
              return
            }
            hideFields(form)
            show(form, 'success')
            return
          }
          // a named field error goes on the field itself, which is where the
          // visitor is looking; everything else shows the error block
          var named = r.data && r.data.field ? form.elements[r.data.field] : null
          if (named && typeof named.setCustomValidity === 'function') {
            named.setCustomValidity(r.data.error || 'Please check this field')
            named.addEventListener(
              'input',
              function () {
                named.setCustomValidity('')
              },
              { once: true },
            )
            if (typeof form.reportValidity === 'function') form.reportValidity()
            return
          }
          var block = show(form, 'error')
          if (!block) {
            // no error block authored: say something rather than nothing, or a
            // failed submission looks exactly like no click at all
            var fallback = document.createElement('p')
            fallback.setAttribute('data-form-fallback', '')
            fallback.textContent =
              r.status === 429
                ? 'Too many submissions — please try again in a minute.'
                : (r.data && r.data.error) || 'Something went wrong. Please try again.'
            form.appendChild(fallback)
          }
        })
        .catch(function () {
          if (button) button.disabled = false
          show(form, 'error')
        })
    })
  })
})()
