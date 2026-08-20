import type { Component } from 'vue'
import {
  Square,
  SquareDashed,
  Container,
  LayoutGrid,
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
} from 'lucide-vue-next'

export interface PaletteItem {
  type: string
  label: string
  icon: Component
}

/** the insertable built-in elements, grouped for browsing — shared by the
 * Elements popover (ElementsPalette) and the ⌘E command palette */
export const ELEMENT_GROUPS: { title: string; items: PaletteItem[] }[] = [
  {
    title: 'Layout',
    items: [
      { type: 'section', label: 'Section', icon: Square },
      { type: 'div', label: 'Div', icon: SquareDashed },
      { type: 'container', label: 'Container', icon: Container },
      { type: 'grid', label: 'Grid', icon: LayoutGrid },
    ],
  },
  {
    title: 'Text',
    items: [
      { type: 'text', label: 'Text', icon: Type },
      { type: 'heading', label: 'Heading', icon: Heading },
      { type: 'paragraph', label: 'Paragraph', icon: Pilcrow },
      { type: 'span', label: 'Span', icon: Baseline },
      { type: 'label', label: 'Label', icon: Tag },
    ],
  },
  {
    title: 'Media',
    items: [
      { type: 'image', label: 'Image', icon: Image },
      { type: 'video', label: 'Video', icon: Video },
    ],
  },
  {
    title: 'Forms',
    items: [
      { type: 'form', label: 'Form', icon: RectangleHorizontal },
      { type: 'input', label: 'Input', icon: FormInput },
      { type: 'select', label: 'Select', icon: SquareChevronDown },
      { type: 'button', label: 'Button', icon: MousePointerClick },
    ],
  },
  {
    title: 'Lists',
    items: [
      { type: 'list', label: 'List', icon: List },
      { type: 'link', label: 'Link', icon: Link },
    ],
  },
]
