<script setup lang="ts">
import ModalDialog from '@/components/modal/ModalDialog.vue'

defineEmits<{
  close: []
}>()

interface Shortcut {
  keys: string[]
  does: string
}

const SHORTCUT_SECTIONS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Elements',
    items: [
      { keys: ['⌘', 'C'], does: 'Copy the selected element' },
      { keys: ['⌘', 'X'], does: 'Cut the selected element' },
      { keys: ['⌘', 'V'], does: 'Paste after the selection' },
      { keys: ['⌘', 'D'], does: 'Duplicate the selection' },
      { keys: ['⌫'], does: 'Delete the selection' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: ['⌘', 'Z'], does: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], does: 'Redo' },
      { keys: ['⌘', 'S'], does: 'Save now' },
    ],
  },
  {
    title: 'Canvas',
    items: [
      { keys: ['Space', 'Drag'], does: 'Pan the canvas' },
      { keys: ['⌘', 'Scroll'], does: 'Zoom toward the cursor' },
      { keys: ['⌘', '+'], does: 'Zoom in' },
      { keys: ['⌘', '−'], does: 'Zoom out' },
      { keys: ['⌘', '0'], does: 'Reset the view' },
      { keys: ['C', 'Click'], does: 'Add a comment' },
    ],
  },
  {
    title: 'Code editor',
    items: [
      { keys: ['Tab'], does: 'Accept the suggestion / indent' },
      { keys: ['+', 'S'], does: 'Open Style for the line' },
      { keys: ['+', 'I'], does: 'Open Interactions for the line' },
      { keys: ['+', 'C'], does: 'Open Content for the line' },
      { keys: ['Esc'], does: 'Close the panel, back to the code' },
    ],
  },
  {
    title: 'Help',
    items: [{ keys: ['?'], does: 'Open this cheatsheet' }],
  },
]

interface SyntaxRule {
  example: string[]
  /** component-flavoured examples render in green like the editor */
  component?: boolean
  does: string
}

const SYNTAX_RULES: SyntaxRule[] = [
  { example: [':h1:'], does: 'A leaf element' },
  {
    example: [':section', '\t:h1:', 'section:'],
    does: 'A block with children — one token per line, tabs nest',
  },
  {
    example: [':Card', '\t…', 'Card:'],
    component: true,
    does: 'A component block; edits sync across every instance',
  },
  {
    example: [':Card:'],
    component: true,
    does: 'Expands into the full component block as you type',
  },
  {
    example: [':collection-list(post)', '\t:h2(title):', 'collection-list:'],
    does: 'Repeats its children once per entry of the collection',
  },
  { example: [':collection-item(post):'], does: 'One picked entry, rendered via its template' },
  { example: [':h1(title):'], does: 'Binds the element to a collection field' },
  { example: ['@setup', ':body(post)'], does: 'Page meta scaffold / collection template binding' },
]
</script>

<template>
  <ModalDialog title="Shortcuts & syntax" size="lg" @close="$emit('close')">
    <div class="grid grid-cols-2 gap-x-8 gap-y-4">
      <!-- shortcuts -->
      <div class="flex flex-col gap-4">
        <div v-for="section in SHORTCUT_SECTIONS" :key="section.title" class="flex flex-col gap-1.5">
          <p class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {{ section.title }}
          </p>
          <div
            v-for="item in section.items"
            :key="item.does"
            class="flex items-center justify-between gap-3"
          >
            <span class="flex shrink-0 items-center gap-1">
              <kbd
                v-for="key in item.keys"
                :key="key"
                class="rounded-md border border-input bg-muted px-1.5 py-0.5 font-mono text-[10px] shadow-sm"
                >{{ key }}</kbd
              >
            </span>
            <span class="text-right text-xs text-muted-foreground">{{ item.does }}</span>
          </div>
        </div>
      </div>

      <!-- syntax -->
      <div class="flex flex-col gap-3">
        <p class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Syntax</p>
        <div v-for="rule in SYNTAX_RULES" :key="rule.does" class="flex flex-col gap-1">
          <pre
            class="rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] leading-4 whitespace-pre tab-2"
            :class="rule.component ? 'text-success' : 'text-foreground'"
            >{{ rule.example.join('\n') }}</pre
          >
          <p class="text-xs text-muted-foreground">{{ rule.does }}</p>
        </div>
      </div>
    </div>
  </ModalDialog>
</template>
