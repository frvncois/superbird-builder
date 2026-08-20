import type { Component } from 'vue'
import {
  Square,
  SquareDashed,
  Container,
  LayoutGrid,
  PanelTop,
  PanelBottom,
  Navigation,
  Type,
  Heading,
  Pilcrow,
  Baseline,
  Tag,
  Image,
  Video,
  RectangleHorizontal,
  FormInput,
  SquareChevronDown,
  MousePointerClick,
  List,
  Link,
  Component as ComponentIcon,
  Layers,
  FileText,
} from 'lucide-vue-next'
import { isComponentType } from './components'

const ICONS: Record<string, Component> = {
  body: Square,
  section: Square,
  div: SquareDashed,
  container: Container,
  grid: LayoutGrid,
  header: PanelTop,
  footer: PanelBottom,
  nav: Navigation,
  main: Square,
  article: FileText,
  aside: RectangleHorizontal,
  text: Type,
  heading: Heading,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  paragraph: Pilcrow,
  span: Baseline,
  label: Tag,
  image: Image,
  video: Video,
  form: RectangleHorizontal,
  input: FormInput,
  dropdown: SquareChevronDown,
  select: SquareChevronDown,
  button: MousePointerClick,
  list: List,
  'list-item': List,
  link: Link,
  'collection-list': Layers,
  'collection-item': FileText,
}

/** the palette/header icon for an element type (components → the component glyph) */
export function elementIcon(type: string | undefined): Component {
  if (!type) return Square
  if (isComponentType(type)) return ComponentIcon
  return ICONS[type] ?? Square
}
