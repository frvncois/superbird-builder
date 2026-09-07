import type { ComponentDef, ElementNode } from '@/types/editor'

/** component types are Capitalized in the syntax; built-ins stay lowercase */
export function isComponentType(type: string): boolean {
  return /^[A-Z]/.test(type)
}

/** turns raw user input into a valid, unique component name ('my card' → 'MyCard') */
export function normalizeComponentName(raw: string, taken: string[]): string {
  const cleaned = raw
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  const base = /^[A-Za-z]/.test(cleaned) ? cleaned : `C${cleaned}`
  const name = base.charAt(0).toUpperCase() + base.slice(1) || 'Component'
  if (!taken.includes(name)) return name
  let n = 2
  while (taken.includes(`${name}${n}`)) n++
  return `${name}${n}`
}

/** serializes a master node back into syntax lines at the given indent —
 * including its code-owned decorations: the [arg] binding and the @link
 * suffix (dropping them would strip bindings/links from every instance on
 * each structure rewrite) */
export function serializeNode(node: ElementNode, indent: string): string[] {
  const arg = node.arg ? `[${node.arg}]` : ''
  // node.link stores '@item' for the current-entry sentinel, verbatim otherwise
  const link = node.link ? `@${node.link === '@item' ? 'item' : node.link}` : ''
  if (!node.children.length) return [`${indent}:${node.type}${arg}:${link}`]
  return [
    `${indent}:${node.type}${arg}${link}`,
    ...node.children.flatMap((child) => serializeNode(child, `${indent}\t`)),
    `${indent}${node.type}:`,
  ]
}

/**
 * Expands freshly typed component references into their full editable
 * block: a `:Card:` leaf, or an empty `:Card` / `Card:` pair, becomes
 * `:Card` + the master's structure + `Card:`.
 */
export function expandComponentInstances(code: string, components: ComponentDef[]): string {
  if (!components.length) return code
  const lines = code.split('\n')
  const out: string[] = []
  /** component blocks currently open — a component never expands inside itself */
  const stack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    const indent = line.match(/^\t*/)![0]

    const close = trimmed.match(/^([A-Z][a-zA-Z0-9-]*):$/)
    if (close && stack[stack.length - 1] === close[1]) {
      stack.pop()
      out.push(line)
      continue
    }

    const leaf = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*):$/)
    const leafDef = leaf ? components.find((c) => c.name === leaf[1]) : null
    if (leafDef && !stack.includes(leafDef.name)) {
      out.push(`${indent}:${leafDef.name}`)
      out.push(...leafDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)))
      out.push(`${indent}${leafDef.name}:`)
      continue
    }

    const open = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*)$/)
    const openDef = open ? components.find((c) => c.name === open[1]) : null
    if (openDef && !stack.includes(openDef.name) && lines[i + 1]?.trim() === `${openDef.name}:`) {
      out.push(line)
      out.push(...openDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)))
      out.push(lines[i + 1]!)
      i++
      continue
    }

    if (open) stack.push(open[1]!)
    out.push(line)
  }

  return out.join('\n')
}
