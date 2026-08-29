// Generates public/demo-project.json — the "Brume" showcase: a Material You
// (Material Design 3) one-page marketing site for a fictional Montréal
// specialty coffee roaster with a subscription. One page (hero, features,
// how-it-works, pricing, testimonials, FAQ, journal preview, CTA) + a post
// collection with a template page, shared Header/Footer components, a reused
// interaction library, Roboto, en/fr locales. Load it via /admin?demo
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/generate-demo.ts

import { writeFileSync } from 'node:fs'
import { buildDocument } from '../src/lib/document'
import { parseSyntax } from '../src/lib/syntax'
import { defaultBreakpoints } from '../src/lib/factories'
import { defaultSettings } from '../src/lib/settings'
import { walkNodes } from '../src/lib/tree'
import type {
  Collection,
  ComponentDef,
  ElementNode,
  Interaction,
  InteractionBinding,
  Page,
  Project,
} from '../src/types/editor'

const uuid = () => crypto.randomUUID()

// ---------- Material 3 class vocabulary ----------
// design tokens (settings.tokens below) provide bg-primary, bg-surface-container,
// text-on-surface-variant, ring-primary, etc.

/** M3 standard easing — the spec's one curve for everything */
const EASE = 'ease-[cubic-bezier(0.2,0,0,1)]'
const MICRO = `transition-all duration-200 ${EASE} motion-reduce:transition-none`
const STANDARD = `transition-all duration-300 ${EASE} motion-reduce:transition-none`
const FOCUS =
  'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none'

/** filled pill button — hover/active are opacity state layers, never new colors */
const BTN_FILLED = `rounded-full bg-primary px-8 py-4 text-sm font-medium text-white shadow-sm ${MICRO} hover:bg-primary/90 hover:shadow-md active:bg-primary/80 active:scale-95 ${FOCUS}`
/** tonal pill button on the secondary container */
const BTN_TONAL = `rounded-full bg-secondary-container px-8 py-4 text-sm font-medium text-on-secondary-container ${MICRO} hover:bg-secondary-container/70 hover:shadow-sm active:scale-95 ${FOCUS}`
/** small tonal chip / badge */
const CHIP =
  'w-fit rounded-full bg-secondary-container px-4 py-1.5 text-xs font-medium tracking-wide text-on-secondary-container'
/** resting card — elevation comes from the tonal surface + a soft shadow */
const CARD = `rounded-[24px] bg-surface-container p-8 shadow-sm ${STANDARD}`

const H2 = 'text-[32px] font-medium leading-[1.2] tracking-tight text-on-surface md:text-[48px]'
const LEAD = 'text-[16px] leading-[1.6] text-on-surface-variant md:text-[20px]'
const BODY = 'text-[16px] leading-[1.6] text-on-surface-variant'

/** section header stack (chip + headline + optional lead), centered */
const SECTION_HEAD = 'mx-auto flex max-w-2xl flex-col items-center gap-4 text-center'

// ---------- shared interaction library ----------
// the motion language of the whole site: everything below binds one of these
// three, so editing one retunes the site

const LIB = {
  rise: {
    id: uuid(),
    name: 'Rise in',
    toClasses: 'translate-y-0 opacity-100',
    duration: 'duration-500',
    easing: EASE,
  },
  lift: {
    id: uuid(),
    name: 'Card lift',
    toClasses: 'scale-[1.02] shadow-md',
    duration: 'duration-300',
    easing: EASE,
  },
  layer: {
    id: uuid(),
    name: 'State layer',
    toClasses: 'bg-primary/10 text-primary',
    duration: 'duration-200',
    easing: EASE,
  },
} satisfies Record<string, Interaction>

const interactions: Interaction[] = Object.values(LIB)

const bind = (
  interaction: Interaction,
  trigger: InteractionBinding['trigger'],
): Omit<InteractionBinding, 'id'> => ({ interactionId: interaction.id, trigger, targetId: null })

/** base classes for elements that rise into view */
const RISE_BASE = 'translate-y-6 opacity-0'

// ---------- helpers ----------

interface NodeProps {
  classes?: string
  content?: string
  src?: string
  link?: string
  htmlId?: string
  locales?: ElementNode['locales']
  interactions?: Omit<InteractionBinding, 'id'>[]
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
  if (props.length !== nodes.length)
    throw new Error(`props/node mismatch on ${page.name}: ${props.length} props, ${nodes.length} nodes`)
  props.forEach((p, i) => {
    const n = nodes[i]!
    if (p.classes) n.classes = p.classes
    if (p.content) n.content = p.content
    if (p.src) n.src = p.src
    if (p.link) n.link = p.link
    if (p.htmlId) n.htmlId = p.htmlId
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
    htmlId: props.htmlId,
    locales: props.locales,
    interactions: props.interactions?.map((x) => ({ ...x, id: uuid() })),
    children,
  }
}

/** one page section — lines and their DFS props kept side by side so
 * alignment is checked section-by-section, not across the whole page */
interface Sec {
  lines: string[]
  props: NodeProps[]
}

const indent = (lines: string[]) => lines.map((l) => '\t' + l)

// ---------- M3 journal covers (tonal blobs + one crisp motif) ----------

const svg = (body: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">` +
      `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter></defs>` +
      `<rect width="800" height="600" fill="#F3EDF7"/>${body}</svg>`,
  )

const COVERS = {
  // resting roasts — a bean at rest under a soft primary haze
  rest: svg(
    '<circle cx="620" cy="120" r="180" fill="#6750A4" opacity=".25" filter="url(#b)"/>' +
      '<circle cx="140" cy="500" r="160" fill="#7D5260" opacity=".2" filter="url(#b)"/>' +
      '<ellipse cx="400" cy="310" rx="150" ry="200" fill="#6750A4"/>' +
      '<path d="M400 130 C330 250 470 370 400 490" stroke="#E8DEF8" stroke-width="28" fill="none" stroke-linecap="round"/>',
  ),
  // the farm visit — plant rows as a tonal dot grid on a hillside
  farm: svg(
    '<circle cx="180" cy="140" r="170" fill="#E8DEF8" opacity=".9" filter="url(#b)"/>' +
      '<circle cx="660" cy="480" r="170" fill="#6750A4" opacity=".2" filter="url(#b)"/>' +
      '<path d="M0 430 Q400 260 800 400 L800 600 L0 600 Z" fill="#6750A4"/>' +
      '<g fill="#E8DEF8">' +
      '<circle cx="160" cy="470" r="22"/><circle cx="300" cy="440" r="22"/><circle cx="440" cy="425" r="22"/><circle cx="580" cy="435" r="22"/><circle cx="710" cy="465" r="22"/>' +
      '<circle cx="230" cy="540" r="22"/><circle cx="370" cy="515" r="22"/><circle cx="510" cy="505" r="22"/><circle cx="650" cy="525" r="22"/>' +
      '</g>',
  ),
  // the pour-over — a rounded funnel and one patient drop
  pour: svg(
    '<circle cx="650" cy="150" r="170" fill="#7D5260" opacity=".2" filter="url(#b)"/>' +
      '<circle cx="120" cy="470" r="150" fill="#6750A4" opacity=".2" filter="url(#b)"/>' +
      '<path d="M250 170 h300 a30 30 0 0 1 24 48 L448 350 a60 60 0 0 1 -96 0 L226 218 a30 30 0 0 1 24 -48 Z" fill="#6750A4"/>' +
      '<circle cx="400" cy="430" r="26" fill="#7D5260"/>' +
      '<rect x="300" y="490" width="200" height="36" rx="18" fill="#E8DEF8"/>',
  ),
}

// ---------- Header component (sticky glass app bar, used at the top) ----------

const NAV_LINKS: [string, string, string][] = [
  ['Why Brume', 'Pourquoi Brume', '#why'],
  ['How it works', 'Comment ça marche', '#how'],
  ['Pricing', 'Tarifs', '#pricing'],
  ['Journal', 'Journal', '#journal'],
  ['FAQ', 'FAQ', '#faq'],
]

const NAV_PILL = `rounded-full px-4 py-2 text-sm font-medium text-on-surface-variant ${MICRO} active:scale-95 ${FOCUS}`

const headerRoot = node('Header', {}, [
  node(
    'header',
    {
      classes:
        'sticky top-0 z-50 flex items-center justify-between border-b border-outline/20 bg-surface/80 px-6 py-3 backdrop-blur-md',
    },
    [
      node('link', {
        content: 'Brume',
        link: '/',
        classes: `rounded-full px-3 py-1.5 text-xl font-medium tracking-tight text-primary ${MICRO} active:scale-95 ${FOCUS}`,
      }),
      node(
        'nav',
        { classes: 'hidden items-center gap-1 md:flex' },
        NAV_LINKS.map(([en, fr, link]) =>
          node('link', {
            content: en,
            link,
            classes: NAV_PILL,
            locales: { fr: { content: fr } },
            interactions: [bind(LIB.layer, 'hover')],
          }),
        ),
      ),
      node('div', { classes: 'flex items-center gap-2' }, [
        // locale switcher: locale-explicit links are absolute (never re-prefixed)
        node('link', {
          content: 'EN',
          link: '/en',
          classes: `rounded-full px-2.5 py-1.5 text-xs font-medium text-on-surface-variant ${MICRO} hover:bg-primary/10 hover:text-primary ${FOCUS}`,
        }),
        node('link', {
          content: 'FR',
          link: '/fr',
          classes: `rounded-full px-2.5 py-1.5 text-xs font-medium text-on-surface-variant ${MICRO} hover:bg-primary/10 hover:text-primary ${FOCUS}`,
        }),
        node('link', {
          content: 'Subscribe',
          link: '#pricing',
          classes: `rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm ${MICRO} hover:bg-primary/90 active:bg-primary/80 active:scale-95 ${FOCUS}`,
          locales: { fr: { content: 'S’abonner' } },
        }),
      ]),
    ],
  ),
])

const header: ComponentDef = { id: uuid(), name: 'Header', root: headerRoot }

const HEADER_SEC: Sec = {
  lines: [
    ':Header',
    '\t:header',
    '\t\t:link:',
    '\t\t:nav',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\tnav:',
    '\t\t:div',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\tdiv:',
    '\theader:',
    'Header:',
  ],
  props: Array.from({ length: 13 }, () => ({})),
}

// ---------- Footer component (tonal band with rounded shoulder) ----------

const footerRoot = node('Footer', {}, [
  node('footer', { classes: 'mt-8 rounded-t-[32px] bg-surface-container px-6 pt-16 pb-8 md:px-12' }, [
    node('div', { classes: 'mx-auto flex max-w-6xl flex-col gap-12 md:flex-row md:justify-between' }, [
      node('div', { classes: 'flex max-w-sm flex-col gap-4' }, [
        node('span', { content: 'Brume', classes: 'text-2xl font-medium tracking-tight text-primary' }),
        node('paragraph', {
          content:
            'Small-batch coffee roasted every Tuesday in Mile-End, Montréal, and shipped the same afternoon.',
          classes: 'text-[14px] leading-[1.6] text-on-surface-variant',
          locales: {
            fr: {
              content:
                'Du café en petits lots, torréfié chaque mardi dans le Mile-End à Montréal et expédié l’après-midi même.',
            },
          },
        }),
      ]),
      node(
        'nav',
        { classes: 'flex flex-col items-start gap-1' },
        NAV_LINKS.map(([en, fr, link]) =>
          node('link', {
            content: en,
            link,
            classes: `rounded-full px-3 py-1.5 text-[14px] font-medium text-on-surface-variant ${MICRO} active:scale-95 ${FOCUS}`,
            locales: { fr: { content: fr } },
            interactions: [bind(LIB.layer, 'hover')],
          }),
        ),
      ),
      node('div', { classes: 'flex flex-col gap-2 text-[14px] text-on-surface-variant' }, [
        node('link', {
          content: 'hello@brume.coffee',
          link: 'mailto:hello@brume.coffee',
          classes: `w-fit rounded-full px-3 py-1.5 font-medium ${MICRO} hover:bg-primary/10 hover:text-primary ${FOCUS}`,
        }),
        node('span', { content: '5445 av. de Gaspé, Montréal', classes: 'px-3' }),
      ]),
    ]),
    node(
      'div',
      {
        classes:
          'mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-outline/20 pt-6 text-[12px] text-on-surface-variant',
      },
      [
        node('span', { content: '© 2026 Brume Torréfacteur inc.' }),
        node('span', {
          content: 'Roasted with patience in Mile-End.',
          locales: { fr: { content: 'Torréfié avec patience dans le Mile-End.' } },
        }),
      ],
    ),
  ]),
])

const footer: ComponentDef = { id: uuid(), name: 'Footer', root: footerRoot }

const FOOTER_SEC: Sec = {
  lines: [
    ':Footer',
    '\t:footer',
    '\t\t:div',
    '\t\t\t:div',
    '\t\t\t\t:span:',
    '\t\t\t\t:paragraph:',
    '\t\t\tdiv:',
    '\t\t\t:nav',
    '\t\t\t\t:link:',
    '\t\t\t\t:link:',
    '\t\t\t\t:link:',
    '\t\t\t\t:link:',
    '\t\t\t\t:link:',
    '\t\t\tnav:',
    '\t\t\t:div',
    '\t\t\t\t:link:',
    '\t\t\t\t:span:',
    '\t\t\tdiv:',
    '\t\tdiv:',
    '\t\t:div',
    '\t\t\t:span:',
    '\t\t\t:span:',
    '\t\tdiv:',
    '\tfooter:',
    'Footer:',
  ],
  props: Array.from({ length: 18 }, () => ({})),
}

// ---------- post collection (journal preview cards + article pages) ----------

const POSTS = [
  {
    title: 'Why we rest our roasts for three days',
    titleFr: 'Pourquoi nous laissons reposer nos torréfactions trois jours',
    date: '2026-08-11',
    cover: COVERS.rest,
    excerpt: 'Fresh doesn’t mean straight from the drum. Here’s the science of degassing.',
    excerptFr: 'Frais ne veut pas dire tout droit sorti du tambour. Voici la science du dégazage.',
    body: 'Right off the drum, a roast is still exhaling carbon dioxide — brew it that day and the gas fights the water, leaving the cup sour and hollow. We rest every lot for three days before it ships, which is why your bag lands at exactly the moment the flavour opens up. Fresh is a window, not a race, and we time your delivery to the middle of it.',
    bodyFr: 'Au sortir du tambour, une torréfaction exhale encore du dioxyde de carbone — infusez-la le jour même et le gaz repousse l’eau, laissant une tasse acide et creuse. Nous laissons reposer chaque lot trois jours avant l’expédition : votre sac arrive exactement au moment où les arômes s’ouvrent. La fraîcheur est une fenêtre, pas une course, et nous calons votre livraison en plein milieu.',
  },
  {
    title: 'A visit to Finca El Mirador, Huila',
    titleFr: 'Une visite à la Finca El Mirador, Huila',
    date: '2026-07-22',
    cover: COVERS.farm,
    excerpt: 'Ten days with the family behind our best-selling Colombian lot.',
    excerptFr: 'Dix jours avec la famille derrière notre lot colombien le plus populaire.',
    body: 'The Ordóñez family has farmed the same hillside above Pitalito for three generations, and for the last four harvests every cherry of their caturra has come to us. We spent ten days there in July walking the rows, cupping experimental ferments, and agreeing on next year’s price over dinner — 2.4 times the fair-trade floor, published on every bag. Direct trade is just a slogan until you can name the people; now you can.',
    bodyFr: 'La famille Ordóñez cultive le même versant au-dessus de Pitalito depuis trois générations, et depuis quatre récoltes chaque cerise de leur caturra nous revient. Nous avons passé dix jours là-bas en juillet à arpenter les rangs, à déguster des fermentations expérimentales et à convenir du prix de l’an prochain autour d’un souper — 2,4 fois le plancher équitable, publié sur chaque sac. Le commerce direct n’est qu’un slogan tant qu’on ne peut pas nommer les gens ; maintenant, vous le pouvez.',
  },
  {
    title: 'The $40 pour-over setup we actually recommend',
    titleFr: 'L’équipement à 40 $ que nous recommandons vraiment',
    date: '2026-06-30',
    cover: COVERS.pour,
    excerpt: 'You don’t need a lab. You need a scale, a kettle you can control, and patience.',
    excerptFr: 'Pas besoin d’un laboratoire. Il vous faut une balance, une bouilloire précise et de la patience.',
    body: 'Every week someone asks which $300 brewer to buy, and every week we talk them out of it. A plastic cone, a $15 kitchen scale, and any kettle you can pour slowly beat an expensive machine that hides the variables from you. Spend the difference on better beans — the recipe inside this month’s bag was written for exactly this setup.',
    bodyFr: 'Chaque semaine, quelqu’un nous demande quelle machine à 300 $ acheter, et chaque semaine nous l’en dissuadons. Un cône en plastique, une balance de cuisine à 15 $ et n’importe quelle bouilloire qui verse lentement battent une machine coûteuse qui vous cache les variables. Mettez la différence dans de meilleurs grains — la recette glissée dans le sac de ce mois-ci a été écrite pour exactement cet équipement.',
  },
]

const postTemplate = makePage(
  'Post template',
  '/journal',
  [
    ':article',
    '\t:span[date]:',
    '\t:h1[title]:',
    '\t:image[cover]:',
    '\t:paragraph[body]:',
    'article:',
  ],
  [
    { classes: 'mx-auto flex max-w-2xl flex-col gap-8 bg-surface px-6 pt-24 pb-24 text-on-surface' },
    { classes: CHIP },
    { classes: 'text-[32px] font-medium leading-[1.2] tracking-tight md:text-[48px]' },
    { classes: 'aspect-video w-full rounded-[24px] object-cover shadow-sm md:rounded-[32px]' },
    { classes: 'text-[20px] leading-[1.6] text-on-surface-variant' },
  ],
  'post',
)

const postCollection: Collection = {
  id: uuid(),
  name: 'post',
  fields: [
    { id: uuid(), name: 'title', type: 'text' },
    { id: uuid(), name: 'excerpt', type: 'text' },
    { id: uuid(), name: 'body', type: 'text' },
    { id: uuid(), name: 'date', type: 'date' },
    { id: uuid(), name: 'cover', type: 'image' },
  ],
  templatePageId: postTemplate.id,
  entries: POSTS.map((p, i) => ({
    id: uuid(),
    name: p.title,
    slug: p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    values: { title: p.title, excerpt: p.excerpt, body: p.body, date: p.date, cover: p.cover },
    locales: { fr: { title: p.titleFr, excerpt: p.excerptFr, body: p.bodyFr } },
    createdAt: Date.now() + i,
  })),
}
postTemplate.collectionId = postCollection.id

// ---------- home page sections ----------

// hero — display headline over large organic blur shapes, pill CTAs
const HERO: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t:div',
    '\t:div',
    '\t:div',
    '\t\t:span:',
    '\t\t:h1:',
    '\t\t:paragraph:',
    '\t\t:div',
    '\t\t\t:link:',
    '\t\t\t:link:',
    '\t\tdiv:',
    '\t\t:span:',
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'relative overflow-hidden px-6 pt-20 pb-24 md:pt-28 md:pb-32' },
    { classes: 'pointer-events-none absolute -top-24 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl' },
    { classes: 'pointer-events-none absolute top-40 -right-24 h-80 w-80 rounded-full bg-tertiary/20 blur-3xl' },
    { classes: 'pointer-events-none absolute -bottom-32 left-1/3 h-72 w-[36rem] rounded-full bg-secondary-container/60 blur-3xl' },
    {
      classes: `relative mx-auto flex max-w-4xl flex-col items-center gap-8 text-center ${RISE_BASE}`,
      interactions: [bind(LIB.rise, 'appear')],
    },
    {
      classes: CHIP,
      content: 'Roasted in Mile-End every Tuesday',
      locales: { fr: { content: 'Torréfié dans le Mile-End chaque mardi' } },
    },
    {
      classes: 'max-w-3xl text-[40px] font-medium leading-[1.2] tracking-tight text-on-surface md:text-[56px]',
      content: 'Coffee roasted this week, not this quarter.',
      locales: { fr: { content: 'Un café torréfié cette semaine, pas ce trimestre.' } },
    },
    {
      classes: `max-w-2xl ${LEAD}`,
      content:
        'Brume roasts small lots in Mile-End every Tuesday and ships the same afternoon. Your subscription arrives at peak flavour — usually within 48 hours of leaving the drum.',
      locales: {
        fr: {
          content:
            'Brume torréfie de petits lots dans le Mile-End chaque mardi et expédie l’après-midi même. Votre abonnement arrive au sommet de sa saveur — habituellement moins de 48 heures après la sortie du tambour.',
        },
      },
    },
    { classes: 'flex flex-wrap items-center justify-center gap-4' },
    {
      classes: `${BTN_FILLED} text-base`,
      content: 'Start your subscription',
      link: '#pricing',
      locales: { fr: { content: 'Commencer votre abonnement' } },
    },
    {
      classes: BTN_TONAL,
      content: 'See how it works',
      link: '#how',
      locales: { fr: { content: 'Voir comment ça marche' } },
    },
    {
      classes: 'text-[14px] text-on-surface-variant',
      content: 'From $22 a month · Pause or cancel anytime · Free shipping in Canada',
      locales: {
        fr: { content: 'À partir de 22 $ par mois · Pause ou annulation en tout temps · Livraison gratuite au Canada' },
      },
    },
  ],
}

// features — four tonal cards that lift on hover, one blur shape behind
const FEATURE_CARDS = [
  {
    icon: '☕',
    title: 'Roasted, not stockpiled',
    titleFr: 'Torréfié, pas entreposé',
    body: 'We roast every Tuesday in four-kilo batches and ship the same day. Nothing sits on a shelf — including your coffee.',
    bodyFr: 'Nous torréfions chaque mardi en lots de quatre kilos et expédions le jour même. Rien ne dort sur une tablette — surtout pas votre café.',
  },
  {
    icon: '🌱',
    title: 'Traceable to the farm',
    titleFr: 'Traçable jusqu’à la ferme',
    body: 'Every bag names the farm, the lot, and what we paid for it. This season: Huila, Colombia and Sidama, Ethiopia.',
    bodyFr: 'Chaque sac nomme la ferme, le lot et le prix que nous avons payé. Cette saison : Huila, en Colombie, et Sidama, en Éthiopie.',
  },
  {
    icon: '⚙️',
    title: 'Matched to your brewer',
    titleFr: 'Adapté à votre cafetière',
    body: 'Tell us if you pour, press, or pull espresso. We tune the roast profile and grind to fit — no generic “medium roast” here.',
    bodyFr: 'Dites-nous si vous filtrez, pressez ou tirez un espresso. Nous ajustons le profil de torréfaction et la mouture — pas de « torréfaction moyenne » générique ici.',
  },
  {
    icon: '⏸️',
    title: 'Yours to pause',
    titleFr: 'À vous de décider',
    body: 'Skip a month, switch beans, or stop entirely in two taps. A subscription should feel like a treat, not a contract.',
    bodyFr: 'Sautez un mois, changez de grains ou arrêtez tout en deux clics. Un abonnement devrait être un plaisir, pas un contrat.',
  },
]

const FEATURES: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t:div',
    '\t\t:span:',
    '\t\t:h2:',
    '\t\t:paragraph:',
    '\tdiv:',
    '\t:div',
    ...FEATURE_CARDS.flatMap(() => ['\t\t:div', '\t\t\t:span:', '\t\t\t:h3:', '\t\t\t:paragraph:', '\t\tdiv:']),
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'relative overflow-hidden px-6 py-20', htmlId: 'why' },
    { classes: 'pointer-events-none absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl' },
    { classes: `${SECTION_HEAD} ${RISE_BASE}`, interactions: [bind(LIB.rise, 'appear')] },
    { classes: CHIP, content: 'Why Brume', locales: { fr: { content: 'Pourquoi Brume' } } },
    {
      classes: H2,
      content: 'Freshness you can taste in the first sip.',
      locales: { fr: { content: 'Une fraîcheur qui se goûte dès la première gorgée.' } },
    },
    {
      classes: BODY,
      content:
        'Most grocery-store coffee is months old before you open the bag. Ours has a roast date, a farm, and a plan for your brewer.',
      locales: {
        fr: {
          content:
            'La plupart des cafés d’épicerie ont des mois avant même d’être ouverts. Le nôtre a une date de torréfaction, une ferme et un plan pour votre cafetière.',
        },
      },
    },
    { classes: 'relative mx-auto mt-12 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4' },
    ...FEATURE_CARDS.flatMap((c): NodeProps[] => [
      { classes: `flex flex-col gap-4 ${CARD}`, interactions: [bind(LIB.lift, 'hover')] },
      { classes: 'flex h-14 w-14 items-center justify-center rounded-full bg-secondary-container text-2xl', content: c.icon },
      {
        classes: 'text-[24px] font-medium leading-[1.3] text-on-surface',
        content: c.title,
        locales: { fr: { content: c.titleFr } },
      },
      { classes: BODY, content: c.body, locales: { fr: { content: c.bodyFr } } },
    ]),
  ],
}

// how it works — three steps, numbered badges with a hidden glow that
// reveals on hover (the group pattern)
const STEPS = [
  {
    n: '1',
    title: 'Tell us how you brew',
    titleFr: 'Dites-nous comment vous infusez',
    body: 'Answer three questions — how you brew, how much you drink, and how adventurous you’re feeling. Two minutes, no account needed.',
    bodyFr: 'Répondez à trois questions — votre méthode, votre consommation et votre goût de l’aventure. Deux minutes, sans créer de compte.',
  },
  {
    n: '2',
    title: 'We roast your lot',
    titleFr: 'Nous torréfions votre lot',
    body: 'Tuesday morning your beans go through the drum in our Mile-End roastery, rest just long enough, and are sealed behind a one-way valve.',
    bodyFr: 'Mardi matin, vos grains passent au tambour dans notre atelier du Mile-End, reposent juste assez, puis sont scellés derrière une valve unidirectionnelle.',
  },
  {
    n: '3',
    title: 'It ships that afternoon',
    titleFr: 'Expédié l’après-midi même',
    body: 'Bags leave the same day by carbon-neutral post. Most of Canada sees them within two days — peak-flavour week included.',
    bodyFr: 'Les sacs partent le jour même par la poste carboneutre. La majorité du Canada les reçoit en deux jours — semaine de saveur optimale incluse.',
  },
]

const HOW: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t\t:span:',
    '\t\t:h2:',
    '\t\t:paragraph:',
    '\tdiv:',
    '\t:div',
    ...STEPS.flatMap(() => ['\t\t:div', '\t\t\t:div', '\t\t\t:span:', '\t\t\t:h3:', '\t\t\t:paragraph:', '\t\tdiv:']),
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'px-6 py-20', htmlId: 'how' },
    { classes: `${SECTION_HEAD} ${RISE_BASE}`, interactions: [bind(LIB.rise, 'appear')] },
    { classes: CHIP, content: 'How it works', locales: { fr: { content: 'Comment ça marche' } } },
    {
      classes: H2,
      content: 'Tuesday is roast day. Here’s what happens.',
      locales: { fr: { content: 'Le mardi, c’est jour de torréfaction. Voici ce qui se passe.' } },
    },
    {
      classes: BODY,
      content: 'From your first order to the bag on your counter, in three steps.',
      locales: { fr: { content: 'De votre première commande au sac sur votre comptoir, en trois étapes.' } },
    },
    { classes: 'mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-3' },
    ...STEPS.flatMap((s): NodeProps[] => [
      { classes: `group relative flex flex-col gap-4 overflow-hidden ${CARD} hover:shadow-md` },
      {
        classes: `pointer-events-none absolute -top-8 -left-8 h-36 w-36 rounded-full bg-primary/20 blur-3xl opacity-0 ${STANDARD} group-hover:opacity-100`,
      },
      {
        classes: `relative flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-medium text-white shadow-sm ${MICRO} group-hover:scale-110`,
        content: s.n,
      },
      {
        classes: 'relative text-[24px] font-medium leading-[1.3] text-on-surface',
        content: s.title,
        locales: { fr: { content: s.titleFr } },
      },
      { classes: `relative ${BODY}`, content: s.body, locales: { fr: { content: s.bodyFr } } },
    ]),
  ],
}

// pricing — three tiers, middle tier raised and ringed
interface Tier {
  name: string
  price: string
  desc: string
  descFr: string
  items: [string, string][]
  cta: string
  ctaFr: string
  featured?: boolean
}

const TIERS: Tier[] = [
  {
    name: 'Le Curieux',
    price: '$22',
    desc: 'One bag a month for the curious cup.',
    descFr: 'Un sac par mois pour les curieux.',
    items: [
      ['One 340 g bag, rotating single origin', 'Un sac de 340 g, origine unique en rotation'],
      ['Whole bean or ground to order', 'En grains ou moulu sur commande'],
      ['Tasting card with every lot', 'Fiche de dégustation avec chaque lot'],
      ['Free shipping in Canada', 'Livraison gratuite au Canada'],
    ],
    cta: 'Choose Le Curieux',
    ctaFr: 'Choisir Le Curieux',
  },
  {
    name: 'L’Habitué',
    price: '$38',
    desc: 'Two bags, tuned to your routine.',
    descFr: 'Deux sacs, réglés sur votre routine.',
    items: [
      ['Two 340 g bags — mix origins freely', 'Deux sacs de 340 g — mélangez les origines'],
      ['Espresso or filter roast profiles', 'Profils espresso ou filtre'],
      ['First taste of limited micro-lots', 'Primeur des micro-lots limités'],
      ['Free shipping + surprise samples', 'Livraison gratuite + échantillons surprises'],
    ],
    cta: 'Choose L’Habitué',
    ctaFr: 'Choisir L’Habitué',
    featured: true,
  },
  {
    name: 'La Maisonnée',
    price: '$54',
    desc: 'Three bags for full households.',
    descFr: 'Trois sacs pour les grandes maisonnées.',
    items: [
      ['Three 340 g bags, or one 1 kg + one 340 g', 'Trois sacs de 340 g, ou un 1 kg + un 340 g'],
      ['Priority pick of rare lots', 'Priorité sur les lots rares'],
      ['Quarterly cupping invite in Mile-End', 'Invitation trimestrielle à une dégustation dans le Mile-End'],
      ['Gift a month to a friend, on us', 'Offrez un mois à un ami, à nos frais'],
    ],
    cta: 'Choose La Maisonnée',
    ctaFr: 'Choisir La Maisonnée',
  },
]

const tierLines = (t: Tier) => [
  '\t\t:div',
  ...(t.featured ? ['\t\t\t:span:'] : []),
  '\t\t\t:h3:',
  '\t\t\t:div',
  '\t\t\t\t:span:',
  '\t\t\t\t:span:',
  '\t\t\tdiv:',
  '\t\t\t:paragraph:',
  '\t\t\t:list',
  ...t.items.map(() => '\t\t\t\t:list-item:'),
  '\t\t\tlist:',
  '\t\t\t:button:',
  '\t\tdiv:',
]

const tierProps = (t: Tier): NodeProps[] => [
  {
    classes: t.featured
      ? `relative flex flex-col gap-6 rounded-[32px] bg-surface-container p-8 shadow-lg ring-2 ring-primary ${STANDARD} hover:shadow-lg md:-translate-y-4`
      : `flex flex-col gap-6 rounded-[32px] bg-surface-container p-8 shadow-sm ${STANDARD} hover:shadow-md`,
  },
  ...(t.featured
    ? [
        {
          classes: 'w-fit rounded-full bg-primary px-4 py-1.5 text-xs font-medium tracking-wide text-white',
          content: 'Most popular',
          locales: { fr: { content: 'Le plus populaire' } },
        } as NodeProps,
      ]
    : []),
  { classes: 'text-[24px] font-medium text-on-surface', content: t.name },
  { classes: 'flex items-baseline gap-1' },
  { classes: 'text-[48px] font-medium tracking-tight text-on-surface', content: t.price },
  { classes: 'text-[14px] text-on-surface-variant', content: '/month', locales: { fr: { content: '/mois' } } },
  { classes: BODY, content: t.desc, locales: { fr: { content: t.descFr } } },
  { classes: 'flex flex-col gap-3' },
  ...t.items.map(
    ([en, fr]): NodeProps => ({
      classes: 'text-[16px] leading-[1.5] text-on-surface-variant',
      content: `✓ ${en}`,
      locales: { fr: { content: `✓ ${fr}` } },
    }),
  ),
  {
    classes: `mt-auto w-full text-center ${t.featured ? BTN_FILLED : BTN_TONAL}`,
    content: t.cta,
    locales: { fr: { content: t.ctaFr } },
  },
]

const PRICING: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t\t:span:',
    '\t\t:h2:',
    '\t\t:paragraph:',
    '\tdiv:',
    '\t:div',
    ...TIERS.flatMap(tierLines),
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'px-6 py-20', htmlId: 'pricing' },
    { classes: `${SECTION_HEAD} ${RISE_BASE}`, interactions: [bind(LIB.rise, 'appear')] },
    { classes: CHIP, content: 'Pricing', locales: { fr: { content: 'Tarifs' } } },
    {
      classes: H2,
      content: 'Three ways to never run out.',
      locales: { fr: { content: 'Trois façons de ne jamais en manquer.' } },
    },
    {
      classes: BODY,
      content: 'Every tier ships fresh on Tuesdays. Pause, swap, or cancel whenever.',
      locales: { fr: { content: 'Chaque forfait part frais le mardi. Pausez, changez ou annulez quand vous voulez.' } },
    },
    { classes: 'mx-auto mt-16 grid max-w-5xl items-stretch gap-6 md:grid-cols-3' },
    ...TIERS.flatMap(tierProps),
  ],
}

// testimonials — tonal quote cards
const QUOTES = [
  {
    quote: '“I didn’t know coffee had a fresh until the first Brume bag. Grocery-store coffee tastes like cardboard now.”',
    quoteFr: '« Je ne savais pas que le café avait un “frais” avant mon premier sac Brume. Le café d’épicerie goûte le carton maintenant. »',
    initials: 'MG',
    name: 'Marie-Ève G.',
    role: 'Plateau-Mont-Royal',
  },
  {
    quote: '“The espresso profile actually pulls differently — richer, slower. My machine has never been happier.”',
    quoteFr: '« Le profil espresso s’extrait vraiment autrement — plus riche, plus lent. Ma machine n’a jamais été aussi heureuse. »',
    initials: 'ST',
    name: 'Sam T.',
    role: 'Verdun',
  },
  {
    quote: '“We split La Maisonnée at the office. Tuesday delivery has become a small holiday.”',
    quoteFr: '« On partage La Maisonnée au bureau. La livraison du mardi est devenue une petite fête. »',
    initials: 'PK',
    name: 'Priya K.',
    role: 'Vieux-Montréal',
  },
]

const TESTIMONIALS: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t\t:span:',
    '\t\t:h2:',
    '\tdiv:',
    '\t:div',
    ...QUOTES.flatMap(() => [
      '\t\t:div',
      '\t\t\t:paragraph:',
      '\t\t\t:div',
      '\t\t\t\t:span:',
      '\t\t\t\t:div',
      '\t\t\t\t\t:span:',
      '\t\t\t\t\t:span:',
      '\t\t\t\tdiv:',
      '\t\t\tdiv:',
      '\t\tdiv:',
    ]),
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'px-6 py-20' },
    { classes: `${SECTION_HEAD} ${RISE_BASE}`, interactions: [bind(LIB.rise, 'appear')] },
    { classes: CHIP, content: 'From the mailbag', locales: { fr: { content: 'Courrier des abonnés' } } },
    {
      classes: H2,
      content: 'Word travels fast in a small city.',
      locales: { fr: { content: 'Les nouvelles vont vite dans une petite ville.' } },
    },
    { classes: 'mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-3' },
    ...QUOTES.flatMap((q): NodeProps[] => [
      {
        classes: `flex flex-col justify-between gap-8 rounded-[24px] bg-secondary-container p-8 shadow-sm ${STANDARD} hover:shadow-md`,
      },
      {
        classes: 'text-[20px] leading-[1.5] text-on-secondary-container',
        content: q.quote,
        locales: { fr: { content: q.quoteFr } },
      },
      { classes: 'flex items-center gap-3' },
      {
        classes: 'flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-medium text-white',
        content: q.initials,
      },
      { classes: 'flex flex-col' },
      { classes: 'text-[14px] font-medium text-on-secondary-container', content: q.name },
      { classes: 'text-[12px] text-on-surface-variant', content: q.role },
    ]),
  ],
}

// FAQ — two-column tonal cards
const FAQS = [
  {
    q: 'When does my coffee ship?',
    qFr: 'Quand mon café est-il expédié ?',
    a: 'We roast Tuesday morning and ship Tuesday afternoon. Order by Sunday midnight to make that week’s roast; otherwise you’re first in line for the next one.',
    aFr: 'Nous torréfions le mardi matin et expédions le mardi après-midi. Commandez avant dimanche minuit pour la fournée de la semaine ; sinon, vous êtes en tête de liste pour la suivante.',
  },
  {
    q: 'Whole bean or ground?',
    qFr: 'En grains ou moulu ?',
    a: 'Either. If you choose ground, tell us your brewer and we grind to match right before sealing — burrs to bag in under an hour.',
    aFr: 'Les deux. Si vous choisissez moulu, indiquez votre cafetière et nous moulons juste avant de sceller — des meules au sac en moins d’une heure.',
  },
  {
    q: 'Can I skip a month?',
    qFr: 'Puis-je sauter un mois ?',
    a: 'Yes — from your account, in two taps, any time before Sunday. Skipping never costs you your spot on limited lots.',
    aFr: 'Oui — depuis votre compte, en deux clics, jusqu’au dimanche. Sauter un mois ne vous fait jamais perdre votre place sur les lots limités.',
  },
  {
    q: 'Where do the beans come from?',
    qFr: 'D’où viennent les grains ?',
    a: 'Small farms we buy from directly, at prices we publish on every bag. This season: Huila, Colombia; Sidama, Ethiopia; and a honey-process lot from Costa Rica.',
    aFr: 'De petites fermes avec qui nous traitons directement, à des prix publiés sur chaque sac. Cette saison : Huila, en Colombie ; Sidama, en Éthiopie ; et un lot honey du Costa Rica.',
  },
]

const FAQ: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t\t:span:',
    '\t\t:h2:',
    '\tdiv:',
    '\t:div',
    ...FAQS.flatMap(() => ['\t\t:div', '\t\t\t:h3:', '\t\t\t:paragraph:', '\t\tdiv:']),
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'px-6 py-20', htmlId: 'faq' },
    { classes: `${SECTION_HEAD} ${RISE_BASE}`, interactions: [bind(LIB.rise, 'appear')] },
    { classes: CHIP, content: 'FAQ' },
    {
      classes: H2,
      content: 'Questions, poured over.',
      locales: { fr: { content: 'Vos questions, filtrées avec soin.' } },
    },
    { classes: 'mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2' },
    ...FAQS.flatMap((f): NodeProps[] => [
      { classes: `flex flex-col gap-3 rounded-[24px] bg-surface-container p-6 shadow-sm ${MICRO} hover:shadow-md` },
      { classes: 'text-[20px] font-medium leading-[1.3] text-on-surface', content: f.q, locales: { fr: { content: f.qFr } } },
      { classes: BODY, content: f.a, locales: { fr: { content: f.aFr } } },
    ]),
  ],
}

// journal preview — collection-backed cards, image zooms inside its mask
const JOURNAL: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t\t:span:',
    '\t\t:h2:',
    '\t\t:paragraph:',
    '\tdiv:',
    '\t:collection-list[post]',
    '\t\t:div@item',
    '\t\t\t:div',
    '\t\t\t\t:image[cover]:',
    '\t\t\tdiv:',
    '\t\t\t:div',
    '\t\t\t\t:span[date]:',
    '\t\t\t\t:h3[title]:',
    '\t\t\t\t:paragraph[excerpt]:',
    '\t\t\tdiv:',
    '\t\tdiv:',
    '\tcollection-list:',
    'section:',
  ],
  props: [
    { classes: 'px-6 py-20', htmlId: 'journal' },
    { classes: `${SECTION_HEAD} ${RISE_BASE}`, interactions: [bind(LIB.rise, 'appear')] },
    { classes: CHIP, content: 'The Journal', locales: { fr: { content: 'Le Journal' } } },
    {
      classes: H2,
      content: 'Brewing notes.',
      locales: { fr: { content: 'Notes d’infusion.' } },
    },
    {
      classes: BODY,
      content: 'Dispatches from the roastery — origin trips, brew recipes, and the occasional opinion.',
      locales: {
        fr: { content: 'Des nouvelles de l’atelier — voyages aux origines, recettes d’infusion et quelques opinions.' },
      },
    },
    { classes: 'mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-3' },
    {
      classes: `group flex cursor-pointer flex-col overflow-hidden rounded-[24px] bg-surface-container shadow-sm ${STANDARD} hover:shadow-md ${FOCUS}`,
      link: '@item',
    },
    { classes: 'overflow-hidden' },
    { classes: `aspect-[4/3] w-full object-cover ${STANDARD} group-hover:scale-105` },
    { classes: 'flex flex-col gap-3 p-6' },
    { classes: 'w-fit rounded-full bg-secondary-container px-3 py-1 text-[12px] font-medium text-on-secondary-container' },
    { classes: 'text-[24px] font-medium leading-[1.3] text-on-surface' },
    { classes: BODY },
  ],
}

// final CTA — primary panel with glass chip, blur shapes, and an M3 filled input
const CTA: Sec = {
  lines: [
    ':section',
    '\t:div',
    '\t\t:div',
    '\t\t:div',
    '\t\t:div',
    '\t\t\t:span:',
    '\t\t\t:h2:',
    '\t\t\t:paragraph:',
    '\t\t\t:form',
    '\t\t\t\t:label:',
    '\t\t\t\t:div',
    '\t\t\t\t\t:input:',
    '\t\t\t\t\t:button:',
    '\t\t\t\tdiv:',
    '\t\t\tform:',
    '\t\t\t:span:',
    '\t\tdiv:',
    '\tdiv:',
    'section:',
  ],
  props: [
    { classes: 'px-6 pt-4 pb-8' },
    {
      classes:
        'relative mx-auto max-w-6xl overflow-hidden rounded-[24px] bg-primary px-6 py-16 shadow-lg md:rounded-[48px] md:px-16 md:py-24',
    },
    { classes: 'pointer-events-none absolute -top-24 -right-20 h-80 w-80 rounded-full bg-white/10 blur-3xl' },
    { classes: 'pointer-events-none absolute -bottom-28 -left-16 h-96 w-96 rounded-full bg-tertiary/40 blur-3xl' },
    {
      classes: `relative flex flex-col items-center gap-6 text-center ${RISE_BASE}`,
      interactions: [bind(LIB.rise, 'appear')],
    },
    {
      classes:
        'rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-medium tracking-wide text-white backdrop-blur-sm',
      content: 'Next roast: Tuesday',
      locales: { fr: { content: 'Prochaine torréfaction : mardi' } },
    },
    {
      classes: 'max-w-2xl text-[32px] font-medium leading-[1.2] tracking-tight text-white md:text-[48px]',
      content: 'Your first bag ships next Tuesday.',
      locales: { fr: { content: 'Votre premier sac part mardi prochain.' } },
    },
    {
      classes: 'max-w-xl text-[16px] leading-[1.6] text-white/80 md:text-[20px]',
      content: 'Tell us where to send it. Skip, swap, or cancel any time — and the first delivery ships free.',
      locales: {
        fr: {
          content:
            'Dites-nous où l’envoyer. Sautez, changez ou annulez en tout temps — et la première livraison est gratuite.',
        },
      },
    },
    { classes: 'flex w-full max-w-md flex-col items-start gap-2' },
    {
      classes: 'text-[12px] font-medium tracking-wide text-white/80',
      content: 'Your email',
      locales: { fr: { content: 'Votre courriel' } },
    },
    { classes: 'flex w-full flex-col gap-3 sm:flex-row' },
    {
      classes: `h-14 w-full rounded-t-xl border-b-2 border-white/40 bg-white/10 px-4 text-white backdrop-blur-sm outline-none ${MICRO} focus:border-white`,
    },
    {
      classes: `h-14 shrink-0 rounded-full bg-white px-8 text-sm font-medium text-primary shadow-sm ${MICRO} hover:bg-white/90 active:bg-white/80 active:scale-95 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary focus-visible:outline-none`,
      content: 'Get started',
      locales: { fr: { content: 'Commencer' } },
    },
    {
      classes: 'text-[12px] text-white/60',
      content: 'No commitment. Rated 4.9 by 1,200+ subscribers.',
      locales: { fr: { content: 'Sans engagement. Noté 4,9 par plus de 1 200 abonnés.' } },
    },
  ],
}

// ---------- assemble the home page ----------

const SECTIONS: Sec[] = [HEADER_SEC, HERO, FEATURES, HOW, PRICING, TESTIMONIALS, FAQ, JOURNAL, CTA, FOOTER_SEC]

const home = makePage(
  'Home',
  '/',
  [':main', ...SECTIONS.flatMap((s) => indent(s.lines)), 'main:'],
  [
    { classes: 'bg-surface text-on-surface antialiased' },
    ...SECTIONS.flatMap((s) => s.props),
  ],
)

// ---------- project ----------

const settings = defaultSettings()
settings.seo = {
  siteName: 'Brume',
  titleTemplate: '%s — Brume',
  description:
    'Specialty coffee roasted every Tuesday in Mile-End, Montréal, and shipped the same day. Subscriptions from $22 a month.',
}
settings.fonts = {
  family: "'Roboto', ui-sans-serif, system-ui, sans-serif",
  googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
}
// the Material 3 light palette, purple seed #6750A4 — every bg-*/text-*/ring-*
// class in the pages above resolves through these tokens
settings.tokens = [
  { name: 'primary', value: '#6750A4' },
  { name: 'tertiary', value: '#7D5260' },
  { name: 'surface', value: '#FFFBFE' },
  { name: 'on-surface', value: '#1C1B1F' },
  { name: 'on-surface-variant', value: '#49454F' },
  { name: 'secondary-container', value: '#E8DEF8' },
  { name: 'on-secondary-container', value: '#1D192B' },
  { name: 'surface-container', value: '#F3EDF7' },
  { name: 'surface-container-low', value: '#E7E0EC' },
  { name: 'outline', value: '#79747E' },
].map((t) => ({ id: uuid(), ...t }))

const project: Project = {
  id: uuid(),
  name: 'Brume',
  pages: [home, postTemplate],
  components: [header, footer],
  collections: [postCollection],
  interactions,
  breakpoints: defaultBreakpoints(),
  comments: [],
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  settings,
}

writeFileSync('public/demo-project.json', JSON.stringify(project, null, 2))
console.log(
  `demo project written: ${project.pages.length} pages,`,
  `${postCollection.entries.length} posts, ${project.components.length} components,`,
  `${interactions.length} shared interactions, ${settings.tokens.length} design tokens,`,
  `locales ${project.locales.join('/')}`,
)
