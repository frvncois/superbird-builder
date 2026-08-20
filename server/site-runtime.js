// Superbird static-site interaction runtime (~1.5 KB). Replays the
// editor's hover/click/appear interactions by toggling Tailwind classes.
// Semantics mirror src/composables/useInteraction.ts: a set of fired
// keys; each [data-tgt] element's class list is fully recomputed from
// its captured base + the toClasses of every fired interaction
// targeting it (never token add/remove — shared tokens would clobber).
;(function () {
  var fxEl = document.getElementById('int-fx')
  if (!fxEl) return
  var fx = JSON.parse(fxEl.textContent || '{}')
  var fired = new Set()

  var targets = []
  document.querySelectorAll('[data-tgt]').forEach(function (el) {
    targets.push({ el: el, base: el.className, keys: el.getAttribute('data-tgt').split(' ') })
  })

  function apply() {
    targets.forEach(function (t) {
      var extra = ''
      t.keys.forEach(function (k) {
        if (fired.has(k) && fx[k]) extra += ' ' + fx[k]
      })
      t.el.className = t.base + extra
    })
  }

  function set(key, on) {
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
})()
