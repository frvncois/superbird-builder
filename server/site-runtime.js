// Guano static-site runtime (~2.5 KB): interactions + runtime conditions.
//
// Interactions replay the editor's hover/click/appear by toggling Tailwind
// classes. Semantics mirror src/composables/useInteraction.ts: a set of
// fired keys; each [data-tgt] element's class list is fully recomputed from
// its captured base + the toClasses of every fired interaction targeting
// it (never token add/remove — shared tokens would clobber).
//
// Runtime conditions evaluate [data-cond] attributes emitted by the
// exporter for viewport/date/query rules whose static half already passed.
// The op table mirrors matchesOp in src/lib/shared/conditions.js — keep
// the two in sync.
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

  // ---------- runtime conditions ----------
  var condEls = document.querySelectorAll('[data-cond]')
  if (!condEls.length) return

  var query = new URLSearchParams(location.search)

  function opMatch(op, a, v) {
    if (op === 'eq') return a === v
    if (op === 'neq') return a !== v
    if (op === 'contains') return v !== '' && a.indexOf(v) !== -1
    if (op === 'empty') return a === ''
    if (op === 'notEmpty') return a !== ''
    if (op === 'gt') return parseFloat(a) > parseFloat(v)
    if (op === 'lt') return parseFloat(a) < parseFloat(v)
    return false
  }

  function ruleMatches(r) {
    if (r.p === 'viewport') return opMatch(r.o, String(window.innerWidth), r.v)
    if (r.p === 'date') {
      var t = Date.parse(r.v)
      return isNaN(t) ? false : opMatch(r.o, String(Date.now()), String(t))
    }
    if (r.p.indexOf('query.') === 0) return opMatch(r.o, query.get(r.p.slice(6)) || '', r.v)
    return false
  }

  var conds = []
  condEls.forEach(function (el) {
    var spec = JSON.parse(el.getAttribute('data-cond'))
    // originals for restoring an unmatched swap (resize can toggle)
    conds.push({ el: el, spec: spec, html: el.innerHTML, src: el.getAttribute('src') })
  })

  function evaluate() {
    conds.forEach(function (c) {
      var matched = c.spec.r.every(ruleMatches)
      var e = c.spec.e
      if (e === 'hide') c.el.hidden = matched
      else if (e === 'show') c.el.hidden = !matched
      else if (e === 'swap') {
        if (c.spec.c !== undefined) {
          if (matched) {
            if (c.spec.h) c.el.innerHTML = c.spec.c
            else c.el.textContent = c.spec.c
          } else c.el.innerHTML = c.html
        }
        if (c.spec.s !== undefined) {
          if (matched) c.el.setAttribute('src', c.spec.s)
          else if (c.src) c.el.setAttribute('src', c.src)
          else c.el.removeAttribute('src')
        }
      }
    })
  }

  evaluate()
  var pending = null
  window.addEventListener('resize', function () {
    clearTimeout(pending)
    pending = setTimeout(evaluate, 100)
  })
})()
