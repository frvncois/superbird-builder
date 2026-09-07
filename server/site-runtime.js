// Guano static-site runtime (~2 KB): interactions.
//
// Interactions replay the editor's hover/click/appear by toggling Tailwind
// classes. Semantics mirror src/composables/useInteraction.ts: a set of
// fired keys; each [data-tgt] element's class list is fully recomputed from
// its captured base + the toClasses of every fired interaction targeting
// it (never token add/remove — shared tokens would clobber).
;(function () {
  // ---------- interactions ----------
  var fxEl = document.getElementById('int-fx')
  if (fxEl) {
    var fx = JSON.parse(fxEl.textContent || '{}')
    var fired = new Set()

    // breakpoint-scoped interactions: width→breakpoint map + per-key scope.
    // Absent when nothing is scoped, so gating is a no-op then.
    var bpEl = document.getElementById('int-bp')
    var bps = bpEl ? JSON.parse(bpEl.textContent || '[]') : []
    bps.sort(function (a, b) { return a.w - b.w })
    var fxbpEl = document.getElementById('int-fxbp')
    var fxbp = fxbpEl ? JSON.parse(fxbpEl.textContent || '{}') : {}

    // key → base classes to REMOVE from the target while that key is fired
    // (same-property conflicts precomputed at export: hidden+flex etc. —
    // without this the cascade picks an arbitrary winner and toggles break)
    var rmEl = document.getElementById('int-fxrm')
    var fxrm = rmEl ? JSON.parse(rmEl.textContent || '{}') : {}

    // current breakpoint id for the viewport (mirrors breakpointIdForWidth in
    // src/lib/responsive.ts): tightest bp still covering this width, else widest
    var curBp = ''
    var computeBp = function () {
      if (!bps.length) return ''
      var w = window.innerWidth
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

    var set = function (key, on) {
      if (on === fired.has(key)) return
      if (on) fired.add(key)
      else fired.delete(key)
      apply()
    }

    var appear = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        appear.unobserve(entry.target)
        JSON.parse(entry.target.getAttribute('data-int')).forEach(function (i) {
          if (i.t === 'appear') set(i.k, true) // fire once, never unfires
        })
      })
    })

    document.querySelectorAll('[data-int]').forEach(function (el) {
      var list = JSON.parse(el.getAttribute('data-int'))
      list.forEach(function (i) {
        if (i.t === 'hover') {
          el.addEventListener('mouseenter', function () {
            set(i.k, true)
          })
          el.addEventListener('mouseleave', function () {
            set(i.k, false)
          })
        } else if (i.t === 'click') {
          el.addEventListener('click', function () {
            set(i.k, !fired.has(i.k))
          })
        } else if (i.t === 'appear') {
          appear.observe(el)
        }
      })
    })
  }
})()
