// Condition evaluation shared VERBATIM by the editor preview
// (useRenderNode), the SPA site preview and the static exporter
// (server/export.mjs) — plain JS so all sides import the same file.
//
// A ConditionSpec is an AND-combined list of rules plus an effect:
//   hide — element hidden while every rule matches
//   show — element visible ONLY while every rule matches
//   swap — element keeps rendering, but content/src come from the spec
//
// Rules with source 'runtime' (viewport/date/query) can't be evaluated
// statically: they are skipped here and shipped to the browser runtime
// (site.js) instead — a spec mixing both applies its static rules at
// export and leaves the rest to the client.

import { resolveBinding, refDisplay } from './fields.js'

export const isRuntimeRule = (rule) => rule.source === 'runtime'

/** locale-aware text of an entry field path; reference fields read as the
 * referenced entry name(s) so name-based rules work */
function fieldText(ctx, path) {
  const b = resolveBinding(ctx.collections ?? [], ctx.collection ?? null, ctx.entry ?? null, path)
  if (!b || !b.entry) return ''
  const { field, entry } = b
  if (field.type === 'reference' || field.type === 'multi-reference') {
    return refDisplay(ctx.collections ?? [], field, entry)
  }
  const override =
    ctx.locale !== ctx.defaultLocale ? entry.locales?.[ctx.locale]?.[field.name] : undefined
  const base = typeof entry.values[field.name] === 'string' ? entry.values[field.name] : ''
  return override || base || ''
}

/** the actual value a rule tests, as a string; null = not statically known */
function ruleValue(rule, ctx) {
  switch (rule.source) {
    case 'field':
      return fieldText(ctx, rule.path)
    case 'context':
      switch (rule.path) {
        case 'locale':
          return ctx.locale ?? ''
        case 'page':
          return ctx.pagePath ?? ''
        case 'index':
          return ctx.index == null ? '' : String(ctx.index)
        case 'first':
          return ctx.index === 0 ? 'true' : 'false'
        case 'last':
          return ctx.index != null && ctx.count != null && ctx.index === ctx.count - 1
            ? 'true'
            : 'false'
        default:
          return ''
      }
    default:
      return null
  }
}

export function matchesOp(op, actual, expected) {
  const a = actual ?? ''
  switch (op) {
    case 'eq':
      return a === expected
    case 'neq':
      return a !== expected
    case 'contains':
      return expected !== '' && a.includes(expected)
    case 'empty':
      return a === ''
    case 'notEmpty':
      return a !== ''
    case 'gt':
      return parseFloat(a) > parseFloat(expected)
    case 'lt':
      return parseFloat(a) < parseFloat(expected)
    default:
      return false
  }
}

/** does one runtime rule match the browser environment
 * env = { viewport: number, now: epoch-ms, query: (param) => string } */
export function runtimeRuleMatches(rule, env) {
  if (rule.path === 'viewport') return matchesOp(rule.op, String(env.viewport), rule.value)
  if (rule.path === 'date') {
    const expected = Date.parse(rule.value)
    if (Number.isNaN(expected)) return false
    return matchesOp(rule.op, String(env.now), String(expected))
  }
  if (rule.path.startsWith('query.')) {
    return matchesOp(rule.op, env.query(rule.path.slice(6)) ?? '', rule.value)
  }
  return false
}

/**
 * The static half of a spec: whether every non-runtime rule matches, plus
 * the runtime rules the browser must still evaluate. The exporter uses
 * this to decide between baking the effect and emitting data-cond attrs.
 */
export function staticMatch(spec, ctx) {
  let matched = true
  const runtime = []
  for (const rule of spec?.rules ?? []) {
    if (isRuntimeRule(rule)) runtime.push(rule)
    else if (matched && !matchesOp(rule.op, ruleValue(rule, ctx), rule.value ?? '')) matched = false
  }
  return { matched, runtime }
}

/**
 * Evaluate a spec against
 * ctx = { collections, collection, entry, locale, defaultLocale,
 *         pagePath, index, count, api, runtimeEnv? }.
 * Runtime rules evaluate against ctx.runtimeEnv when provided (the SPA
 * preview passes the real browser env) and are otherwise treated as
 * matching (the editor canvas; the static export splits them out via
 * staticMatch instead).
 * Returns { visible, content?, src? } — content/src only set while an
 * active swap overrides them.
 */
export function evaluateConditions(spec, ctx) {
  if (!spec || !spec.rules?.length) return { visible: true }
  let matched = true
  for (const rule of spec.rules) {
    if (isRuntimeRule(rule)) {
      if (ctx.runtimeEnv && !runtimeRuleMatches(rule, ctx.runtimeEnv)) {
        matched = false
        break
      }
      continue
    }
    if (!matchesOp(rule.op, ruleValue(rule, ctx), rule.value ?? '')) {
      matched = false
      break
    }
  }
  if (spec.effect === 'swap') {
    return matched
      ? { visible: true, content: spec.swapContent, src: spec.swapSrc }
      : { visible: true }
  }
  return { visible: spec.effect === 'show' ? matched : !matched }
}
