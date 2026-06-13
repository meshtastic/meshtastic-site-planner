<!-- Collapsible parameter section (replaces the Bootstrap accordion). Each
     section owns its open state, so several can be open at once. Content stays
     mounted (v-show) — child onMounted hooks like the map init must persist. -->
<template>
  <section class="overflow-hidden rounded-xl border border-line bg-surface/40">
    <h2 class="m-0">
      <button
        type="button"
        class="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-3 text-left text-[0.9375rem] font-semibold transition"
        :class="open ? 'text-primary' : 'text-ink hover:bg-surface-2'"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span>{{ title }}</span>
        <svg
          class="size-4 shrink-0 transition-transform duration-200"
          :class="open ? 'rotate-180 text-primary' : 'text-ink-muted'"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"
          />
        </svg>
      </button>
    </h2>
    <div v-show="open" class="border-t border-line px-4 py-4">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
const props = defineProps<{ title: string; defaultOpen?: boolean }>();
const open = ref(props.defaultOpen ?? false);
</script>
