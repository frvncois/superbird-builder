<script setup lang="ts">
import { ref } from 'vue'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import { useAuth } from '@/composables/useAuth'

const { setup } = useAuth()

const projectName = ref('')
const email = ref('')
const password = ref('')
const confirm = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  if (busy.value) return
  error.value = null
  if (!projectName.value.trim()) {
    error.value = 'Give your project a name'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    await setup(email.value.trim(), password.value)
    // the editor boot applies this to the freshly created project
    // (a hard reload follows, so it can't be handed over in memory)
    localStorage.setItem('superbird-setup-name', projectName.value.trim())
    window.location.assign('/admin')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Setup failed'
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
    <MainLogo class="size-8" />
    <form
      class="flex w-72 flex-col gap-1"
      @submit.prevent="submit"
    >
      <p class="text-sm font-medium">Setup your project</p>
      <p class="text-[10px] text-muted-foreground">
        Name your project and create the admin login. Everything else is set up inside.
      </p>
      <InputUI size="lg" v-model="projectName" placeholder="Project name" />
      <InputUI size="lg" v-model="email" placeholder="Email" type="email" />
      <InputUI size="lg" v-model="password" placeholder="Password (min. 8 characters)" type="password" />
      <InputUI size="lg" v-model="confirm" placeholder="Confirm password" type="password" />
      <p v-if="error" class="text-[10px] text-danger">{{ error }}</p>
      <ButtonUI variant="default" :disabled="busy" @click="submit">
        {{ busy ? 'Setting up…' : 'Setup project' }}
      </ButtonUI>
      <button type="submit" class="hidden"></button>
    </form>
  </div>
</template>
