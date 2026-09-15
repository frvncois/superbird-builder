import {
  compileAnimation, sampleAnimation, sampleValues, composeMotionStyle, splitByStagger,
  initialStyle, endStyle, foldReverseTime, hasInfinite, parseTrackValue, appearRootMargin,
  lerpColor, parseColor, validateAnimation, validateBinding, scrubProgress, EASINGS, EASING_NAMES,
} from './src/lib/motion'
import type { Animation } from './src/types/editor'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, extra?: unknown) => {
  if (c) { pass++ } else { fail++; console.log(`FAIL — ${l}`, extra ?? '') }
}
const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps
const anim = (steps: Animation['steps']): Animation => ({ id: 'a', name: 'A', steps })

// ---------- easings ----------
for (const name of EASING_NAMES) {
  const f = EASINGS[name]!
  ok(`easing ${name} bounds`, near(f(0), 0) && near(f(1), 1), [name, f(0), f(1)])
}
ok('quart easings exist', EASING_NAMES.includes('quart-out') && EASING_NAMES.includes('quart-in-out'))

// ---------- compile / sequencing ----------
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 400, easing: 'linear' },
    { id: '2', tracks: [{ prop: 'x', from: 0, to: 100 }], duration: 200, easing: 'linear' },
  ]))
  ok('sequential duration', c.duration === 600, c.duration)
  ok('step 2 start', c.tracks[1]!.start === 400)
  ok('t=200 midpoint', near(sampleAnimation(c, 200).opacity as number, 0.5))
  ok('unstarted track omitted', sampleAnimation(c, 100).transform === undefined)
}
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 400, easing: 'linear' },
    { id: '2', tracks: [{ prop: 'x', from: 0, to: 100 }], duration: 400, easing: 'linear', offset: -200 },
  ]))
  ok('negative offset overlaps', c.tracks[1]!.start === 200)
}

// ---------- transform / filter order ----------
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [
      { prop: 'scale', from: 0, to: 2 }, { prop: 'y', from: 0, to: 10 },
      { prop: 'x', from: 0, to: 5 }, { prop: 'rotate', from: 0, to: 90 },
    ], duration: 100, easing: 'linear' },
  ]))
  ok('transform order', sampleAnimation(c, 100).transform === 'translateX(5px) translateY(10px) rotate(90deg) scale(2)',
     sampleAnimation(c, 100).transform)
}

// ---------- UNITS (L-B) ----------
{
  ok('parse bare number uses default unit', JSON.stringify(parseTrackValue(40, 'y')) === '{"n":40,"unit":"px"}')
  ok('parse percent', JSON.stringify(parseTrackValue('-50%', 'x')) === '{"n":-50,"unit":"%"}')
  ok('parse em', JSON.stringify(parseTrackValue('1.5em', 'y')) === '{"n":1.5,"unit":"em"}')
  ok('parse vw', JSON.stringify(parseTrackValue('50vw', 'x')) === '{"n":50,"unit":"vw"}')
  ok('unitless prop rejects a unit', parseTrackValue('2px', 'scale') === null)
  ok('unitless prop takes a number', JSON.stringify(parseTrackValue(2, 'scale')) === '{"n":2,"unit":""}')
  ok('rotate rejects px', parseTrackValue('90px', 'rotate') === null)
  ok('bad unit rejected', parseTrackValue('10furlong', 'x') === null)

  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'x', from: '0%', to: '-100%' }], duration: 100, easing: 'linear' },
  ]))
  ok('percent lerps and keeps its unit', sampleAnimation(c, 50).transform === 'translateX(-50%)',
     sampleAnimation(c, 50).transform)
  ok('percent endpoint', sampleAnimation(c, 100).transform === 'translateX(-100%)')

  const em = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'y', from: '1em', to: '0em' }], duration: 100, easing: 'linear' },
  ]))
  ok('em passthrough', em.tracks.length === 1 && sampleAnimation(em, 0).transform === 'translateY(1em)',
     sampleAnimation(em, 0).transform)

  // a numeric `from` adopts the destination's unit
  const mixed = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'x', from: 0, to: '-100%' }], duration: 100, easing: 'linear' },
  ]))
  ok('numeric from adopts to-unit', sampleAnimation(mixed, 50).transform === 'translateX(-50%)',
     sampleAnimation(mixed, 50).transform)
}

// ---------- CLIP (L-C) ----------
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'clipBottom', from: 100, to: 0 }], duration: 100, easing: 'linear' },
  ]))
  ok('clip start is a full bottom crop', sampleAnimation(c, 0).clipPath === 'inset(0% 0% 100% 0%)',
     sampleAnimation(c, 0).clipPath)
  ok('clip midpoint', sampleAnimation(c, 50).clipPath === 'inset(0% 0% 50% 0%)', sampleAnimation(c, 50).clipPath)
  ok('clip end is uncropped', sampleAnimation(c, 100).clipPath === 'inset(0% 0% 0% 0%)')
  const all = compileAnimation(anim([
    { id: '1', tracks: [
      { prop: 'clipTop', from: 10, to: 0 }, { prop: 'clipLeft', from: 20, to: 0 },
    ], duration: 100, easing: 'linear' },
  ]))
  ok('multiple clip edges compose', all.tracks.length === 2 && sampleAnimation(all, 0).clipPath === 'inset(10% 0% 0% 20%)',
     sampleAnimation(all, 0).clipPath)
}

// ---------- splitByStagger (Bug B) ----------
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'y', from: 50, to: 0 }], duration: 400, easing: 'linear' },
    { id: '2', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 300, easing: 'linear', stagger: 100 },
  ]))
  const split = splitByStagger(c)
  ok('split reports stagger', split.hasStagger)
  ok('element part keeps only unstaggered tracks',
     split.element.tracks.length === 1 && split.element.tracks[0]!.prop === 'y')
  ok('staggered part keeps only staggered tracks',
     split.staggered.tracks.length === 1 && split.staggered.tracks[0]!.prop === 'opacity')
  ok('element part still animates the element',
     sampleAnimation(split.element, 200).transform === 'translateY(25px)',
     sampleAnimation(split.element, 200).transform)
  ok('element part is unaffected by childIndex',
     sampleAnimation(split.element, 200, { childIndex: 3 }).transform === 'translateY(25px)')
  ok('staggered child 1 lags child 0',
     (sampleAnimation(split.staggered, 500, { childIndex: 0 }).opacity as number) >
     (sampleAnimation(split.staggered, 500, { childIndex: 1 }).opacity as number))
  const none = splitByStagger(compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 100, easing: 'linear' },
  ])))
  ok('no stagger → empty staggered part', !none.hasStagger && none.staggered.tracks.length === 0)
  const sel = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 100, easing: 'linear', stagger: 50, staggerSelector: 'img' },
  ]))
  ok('selector carried onto the split', splitByStagger(sel).selector === 'img')
}

// ---------- initialStyle (Bug C) ----------
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }, { prop: 'y', from: 40, to: 0 }], duration: 700, easing: 'ease-out' },
  ]))
  const init = initialStyle(c)
  ok('initialStyle is the pre-play state', init.opacity === 0 && init.transform === 'translateY(40px)', init)
  const measured = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'x', to: 100 }], duration: 100, easing: 'linear' },
  ]))
  ok('measured-from contributes nothing', Object.keys(initialStyle(measured)).length === 0, initialStyle(measured))
  // earliest explicit from wins when two steps touch one property
  const two = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 100, easing: 'linear' },
    { id: '2', tracks: [{ prop: 'opacity', from: 1, to: 0.5 }], duration: 100, easing: 'linear' },
  ]))
  ok('earliest from wins', initialStyle(two).opacity === 0, initialStyle(two))
}

// ---------- foldReverseTime (Bug F) ----------
{
  const loop = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'rotate', from: 0, to: 360 }], duration: 1000, easing: 'linear', repeat: -1 },
  ]))
  ok('infinite detected', hasInfinite(loop))
  ok('infinite folds into one cycle', foldReverseTime(loop, 9500) === 500, foldReverseTime(loop, 9500))
  const once = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 400, easing: 'linear' },
  ]))
  ok('finite clamps to duration', foldReverseTime(once, 9999) === 400)
  ok('mid-play is untouched', foldReverseTime(once, 150) === 150)
  ok('negative folds to 0', foldReverseTime(once, -5) === 0)
}

// ---------- sampleValues / compose (L-E) ----------
{
  const marquee = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'x', from: '0%', to: '-100%' }], duration: 1000, easing: 'linear' },
  ]))
  const entrance = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'y', from: 20, to: 0 }], duration: 1000, easing: 'linear' },
  ]))
  const merged = { ...sampleValues(marquee, 500), ...sampleValues(entrance, 500) }
  const style = composeMotionStyle(merged)
  ok('two plays compose into one transform',
     style.transform === 'translateX(-50%) translateY(10px)', style.transform)
  // equivalence with the convenience wrapper
  ok('sampleAnimation === compose(sampleValues)',
     JSON.stringify(sampleAnimation(marquee, 300)) === JSON.stringify(composeMotionStyle(sampleValues(marquee, 300))))
}

// ---------- appearRootMargin (L-G) ----------
{
  ok('appearAt undefined → no margin', appearRootMargin(undefined) === '0px')
  ok('appearAt 0 → no margin', appearRootMargin(0) === '0px')
  ok('appearAt 0.8 → -20% bottom', appearRootMargin(0.8) === '0px 0px -20% 0px', appearRootMargin(0.8))
  ok('appearAt 0.5 → -50% bottom', appearRootMargin(0.5) === '0px 0px -50% 0px')
  ok('appearAt clamps', appearRootMargin(5) === '0px 0px -0% 0px' || appearRootMargin(5) === '0px 0px -0% 0px')
}

// ---------- yoyo / repeat / stagger / colors / size / scrub (regression) ----------
{
  const c = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 100, easing: 'linear', repeat: 1, yoyo: true },
  ]))
  ok('yoyo span', c.duration === 200)
  ok('yoyo reflects', near(sampleAnimation(c, 150).opacity as number, 0.5))
  ok('yoyo settles at from', near(sampleAnimation(c, 500).opacity as number, 0))
  const r = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 100, easing: 'linear', repeat: 2 },
  ]))
  ok('repeat span', r.duration === 300)
  ok('repeat settles at to', near(sampleAnimation(r, 999).opacity as number, 1))
  const s = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 100, easing: 'linear', stagger: 50 },
  ]))
  ok('stagger child 0', near(sampleAnimation(s, 50, { childIndex: 0 }).opacity as number, 0.5))
  ok('stagger child 1 delayed', sampleAnimation(s, 50, { childIndex: 1 }).opacity === 0)
  ok('stagger child 2 unstarted', sampleAnimation(s, 50, { childIndex: 2 }).opacity === undefined)
  ok('parseColor', JSON.stringify(parseColor('#f00')) === '[255,0,0,1]')
  ok('lerpColor mid', lerpColor('#000000', '#ffffff', 0.5) === 'rgba(128, 128, 128, 1)')
  const col = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'bgColor', from: '#000000', to: '#ffffff' }], duration: 100, easing: 'linear' },
  ]))
  ok('color → backgroundColor', sampleAnimation(col, 100).backgroundColor === 'rgba(255, 255, 255, 1)')
  const h = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'height', from: 0, to: 200 }], duration: 100, easing: 'linear' },
  ]))
  ok('height carries px', sampleAnimation(h, 50).height === '100px')
  const hp = compileAnimation(anim([
    { id: '1', tracks: [{ prop: 'height', from: '0%', to: '100%' }], duration: 100, easing: 'linear' },
  ]))
  ok('height carries %', sampleAnimation(hp, 50).height === '50%', sampleAnimation(hp, 50).height)
  ok('endStyle', endStyle(col).backgroundColor === 'rgba(255, 255, 255, 1)')
  ok('scrub 0', scrubProgress(1000, 800) === 0)
  ok('scrub 1', scrubProgress(200, 800) === 1)
  ok('scrub mid', near(scrubProgress(500, 800), 0.5))
}

// ---------- validation ----------
{
  const good = anim([{ id: '1', tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 400, easing: 'ease-out' }])
  ok('valid passes', validateAnimation(good).ok)
  ok('rejects unknown prop',
     !validateAnimation(anim([{ id: '1', tracks: [{ prop: 'wobble' as never, to: 1 }], duration: 1, easing: 'linear' }])).ok)
  ok('rejects unknown easing',
     !validateAnimation(anim([{ id: '1', tracks: [{ prop: 'opacity', to: 1 }], duration: 1, easing: 'swing' }])).ok)
  ok('accepts percent values',
     validateAnimation(anim([{ id: '1', tracks: [{ prop: 'x', from: '0%', to: '-100%' }], duration: 1, easing: 'linear' }])).ok)
  const mixed = validateAnimation(anim([{ id: '1', tracks: [{ prop: 'x', from: '0px', to: '-100%' }], duration: 1, easing: 'linear' }]))
  ok('rejects mixed units', !mixed.ok && /mixes units/.test((mixed as {error: string}).error), mixed)
  ok('rejects a unit on a unitless prop',
     !validateAnimation(anim([{ id: '1', tracks: [{ prop: 'scale', to: '2px' }], duration: 1, easing: 'linear' }])).ok)
  ok('accepts clip props',
     validateAnimation(anim([{ id: '1', tracks: [{ prop: 'clipBottom', from: 100, to: 0 }], duration: 1, easing: 'linear' }])).ok)
  ok('rejects staggerSelector without stagger',
     !validateAnimation(anim([{ id: '1', tracks: [{ prop: 'opacity', to: 1 }], duration: 1, easing: 'linear', staggerSelector: 'img' }])).ok)
  ok('accepts staggerSelector with stagger',
     validateAnimation(anim([{ id: '1', tracks: [{ prop: 'opacity', to: 1 }], duration: 1, easing: 'linear', stagger: 50, staggerSelector: 'img' }])).ok)
  ok('rejects a hostile selector',
     !validateAnimation(anim([{ id: '1', tracks: [{ prop: 'opacity', to: 1 }], duration: 1, easing: 'linear', stagger: 50, staggerSelector: 'img{}<script>' }])).ok)
  ok('binding ok', validateBinding({ animationId: 'x', trigger: 'appear' }, { animationIds: ['x'] }).ok)
  ok('binding rejects bad trigger', !validateBinding({ animationId: 'x', trigger: 'wiggle' }).ok)
  ok('binding accepts appearAt', validateBinding({ animationId: 'x', trigger: 'appear', appearAt: 0.8 }).ok)
  ok('binding rejects appearAt > 1', !validateBinding({ animationId: 'x', trigger: 'appear', appearAt: 2 }).ok)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
