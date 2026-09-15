// Ready-made timelines. Each preset builds a normal Animation the user can
// then edit freely — they're starting points, not a separate kind, and they
// double as documentation of what the steps editor can express.
import type { Animation, AnimationStep } from '@/types/editor'

export type MotionPresetId =
  | 'fade-in'
  | 'fade-up'
  | 'slide-left'
  | 'slide-right'
  | 'zoom-in'
  | 'blur-reveal'
  | 'rise-settle'
  | 'stagger-up'
  | 'parallax'
  | 'pulse'

export interface MotionPreset {
  id: MotionPresetId
  label: string
  /** the trigger this preset is designed for — the panel pre-selects it */
  trigger: 'appear' | 'load' | 'scrub' | 'hover'
  description: string
  build: () => Pick<Animation, 'name' | 'steps'>
}

const step = (s: Omit<AnimationStep, 'id'>): AnimationStep => ({ id: crypto.randomUUID(), ...s })

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'fade-in',
    label: 'Fade in',
    trigger: 'appear',
    description: 'Simple opacity reveal.',
    build: () => ({
      name: 'Fade in',
      steps: [step({ tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 600, easing: 'ease-out' })],
    }),
  },
  {
    id: 'fade-up',
    label: 'Fade up',
    trigger: 'appear',
    description: 'Rises into place while fading in.',
    build: () => ({
      name: 'Fade up',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'y', from: 40, to: 0 },
          ],
          duration: 700,
          easing: 'ease-out',
        }),
      ],
    }),
  },
  {
    id: 'slide-left',
    label: 'Slide in left',
    trigger: 'appear',
    description: 'Enters from the left edge.',
    build: () => ({
      name: 'Slide in left',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'x', from: -60, to: 0 },
          ],
          duration: 650,
          easing: 'ease-out',
        }),
      ],
    }),
  },
  {
    id: 'slide-right',
    label: 'Slide in right',
    trigger: 'appear',
    description: 'Enters from the right edge.',
    build: () => ({
      name: 'Slide in right',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'x', from: 60, to: 0 },
          ],
          duration: 650,
          easing: 'ease-out',
        }),
      ],
    }),
  },
  {
    id: 'zoom-in',
    label: 'Zoom in',
    trigger: 'appear',
    description: 'Scales up from slightly small.',
    build: () => ({
      name: 'Zoom in',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'scale', from: 0.9, to: 1 },
          ],
          duration: 600,
          easing: 'ease-out',
        }),
      ],
    }),
  },
  {
    id: 'blur-reveal',
    label: 'Blur reveal',
    trigger: 'appear',
    description: 'Sharpens into focus.',
    build: () => ({
      name: 'Blur reveal',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'blur', from: 12, to: 0 },
          ],
          duration: 800,
          easing: 'ease-out',
        }),
      ],
    }),
  },
  {
    id: 'rise-settle',
    label: 'Rise & settle',
    trigger: 'appear',
    description: 'Overshoots slightly, then settles — two steps.',
    build: () => ({
      name: 'Rise & settle',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'y', from: 50, to: 0 },
          ],
          duration: 600,
          easing: 'back-out',
        }),
        step({
          tracks: [{ prop: 'scale', from: 0.98, to: 1 }],
          duration: 300,
          easing: 'ease-out',
          offset: -200,
        }),
      ],
    }),
  },
  {
    id: 'stagger-up',
    label: 'Stagger children',
    trigger: 'appear',
    description: "Children rise one after another — bind it to the list's container.",
    build: () => ({
      name: 'Stagger children',
      steps: [
        step({
          tracks: [
            { prop: 'opacity', from: 0, to: 1 },
            { prop: 'y', from: 30, to: 0 },
          ],
          duration: 550,
          easing: 'ease-out',
          stagger: 90,
        }),
      ],
    }),
  },
  {
    id: 'parallax',
    label: 'Parallax drift',
    trigger: 'scrub',
    description: 'Drifts as the page scrolls — use with the Scrub trigger.',
    build: () => ({
      name: 'Parallax drift',
      steps: [
        step({ tracks: [{ prop: 'y', from: 80, to: -80 }], duration: 1000, easing: 'linear' }),
      ],
    }),
  },
  {
    id: 'pulse',
    label: 'Pulse',
    trigger: 'load',
    description: 'Breathes forever — infinite yoyo loop.',
    build: () => ({
      name: 'Pulse',
      steps: [
        step({
          tracks: [{ prop: 'scale', from: 1, to: 1.05 }],
          duration: 900,
          easing: 'ease-in-out',
          repeat: -1,
          yoyo: true,
        }),
      ],
    }),
  },
]
