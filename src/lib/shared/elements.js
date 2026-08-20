// Element registry — the single source of truth shared VERBATIM by the
// TS client (via src/lib/elements.ts) and the node exporter
// (server/export.mjs), which can't import TypeScript. Plain-JS ESM so
// both can consume it directly. Types live in src/lib/elements.ts.
//
// tag: HTML tag rendered. defaultContent: placeholder text (marks a leaf).
// void: self-closing, no children/text.
export const ELEMENTS_DATA = {
  /** page root wrap — selectable but never added, removed, or reordered */
  body: { tag: 'div' },
  section: { tag: 'section' },
  div: { tag: 'div' },
  container: { tag: 'div' },
  grid: { tag: 'div' },
  header: { tag: 'header' },
  footer: { tag: 'footer' },
  article: { tag: 'article' },
  nav: { tag: 'nav' },
  main: { tag: 'main' },
  aside: { tag: 'aside' },
  text: { tag: 'div', defaultContent: 'Lorem ipsum' },
  h1: { tag: 'h1', defaultContent: 'Lorem ipsum' },
  h2: { tag: 'h2', defaultContent: 'Lorem ipsum' },
  h3: { tag: 'h3', defaultContent: 'Lorem ipsum' },
  h4: { tag: 'h4', defaultContent: 'Lorem ipsum' },
  h5: { tag: 'h5', defaultContent: 'Lorem ipsum' },
  h6: { tag: 'h6', defaultContent: 'Lorem ipsum' },
  heading: { tag: 'h2', defaultContent: 'Lorem ipsum' },
  label: { tag: 'label', defaultContent: 'Label' },
  paragraph: { tag: 'p', defaultContent: 'Dolor sit amet' },
  span: { tag: 'span', defaultContent: 'Dolor sit amet' },
  list: { tag: 'ul' },
  'list-item': { tag: 'li', defaultContent: 'List item' },
  image: { tag: 'img', void: true },
  video: { tag: 'video' },
  form: { tag: 'form' },
  input: { tag: 'input', void: true },
  dropdown: { tag: 'select' },
  select: { tag: 'select' },
  button: { tag: 'button', defaultContent: 'Button' },
  link: { tag: 'a', defaultContent: 'Link' },
  /** repeats its children once per entry of the collection in its arg */
  'collection-list': { tag: 'div' },
  /** renders one picked entry through its collection's template */
  'collection-item': { tag: 'div', defaultContent: '' },
}
