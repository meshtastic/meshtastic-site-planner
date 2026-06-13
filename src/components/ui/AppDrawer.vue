<!-- Right-hand slide-over panel (replaces the Bootstrap offcanvas). A flex
     column: fixed header, scrollable body (default slot), and an optional
     sticky footer slot used for the always-visible Run action. -->
<template>
  <aside
    class="fixed top-[57px] right-0 z-[1000] flex h-[calc(100dvh-57px)] w-[380px] max-w-[92vw] flex-col border-l border-line bg-canvas shadow-2xl transition-transform duration-300 ease-out"
    :class="modelValue ? 'translate-x-0' : 'translate-x-full'"
    :aria-hidden="!modelValue"
    aria-label="Site parameters"
  >
    <header class="flex items-center justify-between border-b border-line px-4 py-3">
      <h2 class="m-0 text-base font-bold text-ink">{{ title }}</h2>
      <button
        type="button"
        class="grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-2 hover:text-ink"
        aria-label="Close panel"
        @click="emit('update:modelValue', false)"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </header>

    <div class="flex-1 space-y-3 overflow-y-auto px-4 py-4 [scrollbar-color:var(--mt-outline-variant)_transparent] [scrollbar-width:thin]">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
      <slot name="footer" />
    </footer>
  </aside>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; title: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
</script>
