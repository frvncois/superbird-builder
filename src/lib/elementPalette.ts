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
  TextCursorInput,
  SquareCheck,
  CircleDot,
  SquareChevronDown,
  MousePointerClick,
  List,
  Link,
  GalleryHorizontalEnd,
  Table,
  Rows3,
  Columns3,
  TableProperties,
  Smile,
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
      { type: 'icon', label: 'Icon', icon: Smile },
    ],
  },
  {
    // button and link are containers now (an icon sits beside the words), so
    // they read as actions rather than as a form control and a list row
    title: 'Actions',
    items: [
      { type: 'button', label: 'Button', icon: MousePointerClick },
      { type: 'link', label: 'Link', icon: Link },
    ],
  },
  {
    title: 'Forms',
    items: [
      { type: 'form', label: 'Form', icon: RectangleHorizontal },
      { type: 'input', label: 'Input', icon: FormInput },
      { type: 'textarea', label: 'Textarea', icon: TextCursorInput },
      { type: 'checkbox', label: 'Checkbox', icon: SquareCheck },
      { type: 'radio', label: 'Radio', icon: CircleDot },
      { type: 'select', label: 'Select', icon: SquareChevronDown },
      { type: 'fieldset', label: 'Fieldset', icon: SquareDashed },
    ],
  },
  {
    title: 'Lists',
    items: [
      { type: 'list', label: 'List', icon: List },
      { type: 'slider', label: 'Slider', icon: GalleryHorizontalEnd },
    ],
  },
  {
    title: 'Table',
    items: [
      { type: 'table', label: 'Table', icon: Table },
      { type: 'thead', label: 'Head', icon: TableProperties },
      { type: 'tbody', label: 'Body', icon: Rows3 },
      { type: 'tr', label: 'Row', icon: Rows3 },
      { type: 'th', label: 'Header cell', icon: Columns3 },
      { type: 'td', label: 'Cell', icon: Columns3 },
    ],
  },
]
