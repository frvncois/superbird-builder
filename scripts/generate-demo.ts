// Generates public/demo-project.json — a full showcase project (4 pages,
// a "service" collection, a shared Navbar component with a locale
// switcher, en/fr locales, interactions, media) used to exercise the
// whole app. Load it in the editor via /admin/editor?demo
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/generate-demo.ts

import { writeFileSync } from 'node:fs'
import { buildDocument } from '../src/lib/document'
import { parseSyntax } from '../src/lib/syntax'
import { defaultBreakpoints } from '../src/lib/factories'
import { walkNodes } from '../src/lib/tree'
import type {
  Collection,
  ComponentDef,
  ElementNode,
  Interaction,
  Page,
  Project,
} from '../src/types/editor'

const uuid = () => crypto.randomUUID()

// ---------- helpers ----------

interface NodeProps {
  classes?: string
  content?: string
  src?: string
  link?: string
  locales?: ElementNode['locales']
  interactions?: Omit<Interaction, 'id'>[]
}

/** builds a page from body lines + DFS-ordered props (body node excluded) */
function makePage(
  name: string,
  path: string,
  bodyLines: string[],
  props: NodeProps[],
  bodyArg?: string,
): Page {
  const code = buildDocument(
    { name, slug: path, status: 'published', locale: 'en' },
    bodyLines.map((l) => '\t' + l),
    bodyArg,
  )
  return applyProps(
    { id: uuid(), name, path, status: 'published', code, elements: parseSyntax(code) },
    props,
  )
}

function applyProps(page: Page, props: NodeProps[]): Page {
  const nodes: ElementNode[] = []
  walkNodes(page.elements, (n) => {
    if (n.type !== 'body') nodes.push(n)
  })
  props.forEach((p, i) => {
    const n = nodes[i]
    if (!n) throw new Error(`props/node mismatch on ${page.name} at index ${i}`)
    if (p.classes) n.classes = p.classes
    if (p.content) n.content = p.content
    if (p.src) n.src = p.src
    if (p.link) n.link = p.link
    if (p.locales) n.locales = p.locales
    if (p.interactions) n.interactions = p.interactions.map((x) => ({ ...x, id: uuid() }))
  })
  return page
}

function node(type: string, props: NodeProps = {}, children: ElementNode[] = []): ElementNode {
  return {
    id: uuid(),
    type,
    content: props.content ?? '',
    classes: props.classes,
    src: props.src,
    link: props.link,
    locales: props.locales,
    interactions: props.interactions?.map((x) => ({ ...x, id: uuid() })),
    children,
  }
}

const hover = (toClasses: string): Omit<Interaction, 'id'> => ({
  trigger: 'hover',
  targetId: null,
  toClasses,
  duration: 'duration-300',
  easing: 'ease-out',
})

// ---------- Navbar component (shared master, used on every page) ----------

const NAV_LINKS: [string, string, string][] = [
  ['Home', 'Accueil', '/'],
  ['About', 'À propos', '/about'],
  ['Services', 'Services', '/services'],
  ['Contact', 'Contact', '/contact'],
]

const navbarRoot = node('Navbar', {}, [
  node(
    'div',
    { classes: 'flex items-center justify-between border-b border-gray-200 px-8 py-4' },
    [
      ...NAV_LINKS.map(([en, fr, link]) =>
        node('link', {
          content: en,
          link,
          classes: 'text-sm font-medium text-gray-700 hover:text-black',
          locales: { fr: { content: fr } },
        }),
      ),
      // locale switcher: locale-explicit links are absolute (never re-prefixed)
      node('div', { classes: 'flex items-center gap-2 text-xs text-gray-400' }, [
        node('link', { content: 'EN', link: '/en', classes: 'hover:text-black' }),
        node('link', { content: 'FR', link: '/fr', classes: 'hover:text-black' }),
      ]),
    ],
  ),
])

const navbar: ComponentDef = { id: uuid(), name: 'Navbar', root: navbarRoot }

/** instance block matching the master's structure (content/link come from it) */
const NAVBAR_BLOCK = [
  ':Navbar',
  '\t:div',
  '\t\t:link:',
  '\t\t:link:',
  '\t\t:link:',
  '\t\t:link:',
  '\t\t:div',
  '\t\t\t:link:',
  '\t\t\t:link:',
  '\t\tdiv:',
  '\tdiv:',
  'Navbar:',
]
const NAVBAR_PROPS: NodeProps[] = Array.from({ length: 9 }, () => ({}))

// ---------- service collection ----------

const SERVICES: { name: string; fr: string; desc: string; descFr: string }[] = [
  {
    name: 'Design',
    fr: 'Design',
    desc: 'Interfaces that feel obvious — research, wireframes, and pixel-perfect UI.',
    descFr: 'Des interfaces évidentes — recherche, maquettes et UI au pixel près.',
  },
  {
    name: 'Development',
    fr: 'Développement',
    desc: 'Fast, accessible websites built on modern foundations.',
    descFr: 'Des sites rapides et accessibles, bâtis sur des fondations modernes.',
  },
  {
    name: 'Branding',
    fr: 'Image de marque',
    desc: 'A voice and identity your customers remember.',
    descFr: 'Une voix et une identité que vos clients retiennent.',
  },
  {
    name: 'SEO',
    fr: 'Référencement',
    desc: 'Content and structure that search engines love.',
    descFr: 'Un contenu et une structure que les moteurs de recherche adorent.',
  },
]

const templatePage = makePage(
  'Service template',
  '/service',
  [':section', '\t:h1(title):', '\t:paragraph(description):', 'section:'],
  [
    { classes: 'mx-auto flex max-w-2xl flex-col gap-4 px-8 py-20' },
    { classes: 'text-5xl font-bold tracking-tight' },
    { classes: 'text-lg text-gray-600' },
  ],
  'service',
)

const collection: Collection = {
  id: uuid(),
  name: 'service',
  fields: [
    { id: uuid(), name: 'title', type: 'text' },
    { id: uuid(), name: 'description', type: 'text' },
  ],
  templatePageId: templatePage.id,
  entries: SERVICES.map((s, i) => ({
    id: uuid(),
    name: s.name,
    slug: s.name.toLowerCase(),
    values: { title: s.name, description: s.desc },
    locales: { fr: { title: s.fr, description: s.descFr } },
    createdAt: Date.now() + i,
  })),
}
templatePage.collectionId = collection.id

// ---------- pages ----------

// a tiny inline SVG so media extraction has something to chew on
const LOGO_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#111"/><circle cx="60" cy="52" r="22" fill="#fbbf24"/><path d="M24 96c10-18 62-18 72 0" stroke="#fbbf24" stroke-width="8" fill="none"/></svg>',
  )

const home = makePage(
  'Home',
  '/',
  [
    ...NAVBAR_BLOCK,
    ':section',
    '\t:h1:',
    '\t:paragraph:',
    '\t:link:',
    'section:',
    ':section',
    '\t:h2:',
    '\t:collection-list(service)',
    '\t\t:div',
    '\t\t\t:h3(title):',
    '\t\t\t:paragraph(description):',
    '\t\tdiv:',
    '\tcollection-list:',
    'section:',
  ],
  [
    ...NAVBAR_PROPS,
    {
      classes: 'flex flex-col items-center gap-6 px-8 py-28 text-center',
      interactions: [
        {
          trigger: 'appear',
          targetId: null,
          toClasses: 'bg-amber-50',
          duration: 'duration-700',
          easing: 'ease-out',
        },
      ],
    },
    {
      classes: 'max-w-3xl text-6xl font-bold tracking-tight',
      content: 'We build superb websites',
      locales: { fr: { content: 'Nous créons des sites superbes' } },
    },
    {
      classes: 'max-w-xl text-lg text-gray-600',
      content: 'Design, development and everything in between — shipped with care.',
      locales: {
        fr: { content: 'Design, développement et tout le reste — livrés avec soin.' },
      },
    },
    {
      classes:
        'rounded-full bg-black px-6 py-3 text-sm font-medium text-white hover:bg-gray-800',
      content: 'See our services',
      link: '/services',
      locales: { fr: { content: 'Voir nos services' } },
    },
    { classes: 'flex flex-col gap-8 px-8 py-20' },
    {
      classes: 'text-3xl font-bold',
      content: 'What we do',
      locales: { fr: { content: 'Ce que nous faisons' } },
    },
    { classes: 'grid grid-cols-2 gap-6' },
    {
      classes: 'flex flex-col gap-2 rounded-2xl border border-gray-200 p-6',
      interactions: [hover('shadow-lg -translate-y-1')],
    },
    { classes: 'text-xl font-semibold' },
    { classes: 'text-sm text-gray-600' },
  ],
)

const about = makePage(
  'About',
  '/about',
  [
    ...NAVBAR_BLOCK,
    ':section',
    '\t:image:',
    '\t:h1:',
    '\t:paragraph:',
    '\t:paragraph:',
    'section:',
  ],
  [
    ...NAVBAR_PROPS,
    {
      classes: 'mx-auto flex max-w-2xl flex-col gap-6 px-8 py-20',
      interactions: [
        {
          trigger: 'appear',
          targetId: null,
          toClasses: 'scale-100 opacity-100',
          duration: 'duration-700',
          easing: 'ease-out',
        },
      ],
    },
    { classes: 'size-24 rounded-3xl', src: LOGO_SVG },
    {
      classes: 'text-5xl font-bold tracking-tight',
      content: 'A small studio with big standards',
      locales: { fr: { content: 'Un petit studio, de grandes exigences' } },
    },
    {
      classes: 'text-lg text-gray-600',
      content:
        'We are a two-person team that has been building for the web since 2012. Every project gets the same attention, whether it ships in a week or a year.',
      locales: {
        fr: {
          content:
            'Nous sommes une équipe de deux personnes qui construit pour le web depuis 2012. Chaque projet reçoit la même attention, qu’il soit livré en une semaine ou en un an.',
        },
      },
    },
    {
      classes: 'text-lg text-gray-600',
      content: 'No account managers, no hand-offs — you talk to the people doing the work.',
      locales: {
        fr: {
          content:
            'Pas d’intermédiaires — vous parlez directement aux personnes qui font le travail.',
        },
      },
    },
  ],
)

const services = makePage(
  'Services',
  '/services',
  [
    ...NAVBAR_BLOCK,
    ':section',
    '\t:h1:',
    '\t:paragraph:',
    '\t:collection-list(service)',
    '\t\t:div',
    '\t\t\t:h3(title):',
    '\t\t\t:paragraph(description):',
    '\t\tdiv:',
    '\tcollection-list:',
    'section:',
  ],
  [
    ...NAVBAR_PROPS,
    { classes: 'flex flex-col gap-8 px-8 py-20' },
    {
      classes: 'text-5xl font-bold tracking-tight',
      content: 'Services',
      locales: { fr: { content: 'Services' } },
    },
    {
      classes: 'max-w-xl text-lg text-gray-600',
      content: 'Four things, done properly.',
      locales: { fr: { content: 'Quatre choses, faites correctement.' } },
    },
    { classes: 'grid grid-cols-2 gap-6' },
    {
      classes: 'flex flex-col gap-2 rounded-2xl border border-gray-200 p-8',
      interactions: [hover('shadow-lg border-gray-400')],
    },
    { classes: 'text-2xl font-semibold' },
    { classes: 'text-gray-600' },
  ],
)

const contact = makePage(
  'Contact',
  '/contact',
  [
    ...NAVBAR_BLOCK,
    ':section',
    '\t:h1:',
    '\t:paragraph:',
    '\t:form',
    '\t\t:label:',
    '\t\t:input:',
    '\t\t:label:',
    '\t\t:input:',
    '\t\t:button:',
    '\tform:',
    'section:',
  ],
  [
    ...NAVBAR_PROPS,
    { classes: 'mx-auto flex max-w-xl flex-col gap-6 px-8 py-20' },
    {
      classes: 'text-5xl font-bold tracking-tight',
      content: 'Say hello',
      locales: { fr: { content: 'Dites bonjour' } },
    },
    {
      classes: 'text-lg text-gray-600',
      content: 'We answer every message within a day.',
      locales: { fr: { content: 'Nous répondons à chaque message en moins d’un jour.' } },
    },
    { classes: 'flex flex-col gap-3' },
    {
      classes: 'text-sm font-medium',
      content: 'Your email',
      locales: { fr: { content: 'Votre courriel' } },
    },
    { classes: 'rounded-lg border border-gray-300 px-4 py-2' },
    {
      classes: 'text-sm font-medium',
      content: 'Message',
      locales: { fr: { content: 'Message' } },
    },
    { classes: 'rounded-lg border border-gray-300 px-4 py-2' },
    {
      classes:
        'mt-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white hover:bg-gray-800',
      content: 'Send',
      locales: { fr: { content: 'Envoyer' } },
      interactions: [
        {
          trigger: 'click',
          targetId: null,
          toClasses: 'bg-emerald-600',
          duration: 'duration-300',
          easing: 'ease-out',
        },
      ],
    },
  ],
)

// ---------- project ----------

const project: Project = {
  id: uuid(),
  name: 'Superb Studio',
  pages: [home, about, services, contact, templatePage],
  components: [navbar],
  collections: [collection],
  breakpoints: defaultBreakpoints(),
  comments: [],
  locales: ['en', 'fr'],
  defaultLocale: 'en',
}

writeFileSync('public/demo-project.json', JSON.stringify(project, null, 2))
console.log(
  `demo project written: ${project.pages.length} pages, ${collection.entries.length} entries,`,
  `${project.components.length} component(s), locales ${project.locales.join('/')}`,
)
