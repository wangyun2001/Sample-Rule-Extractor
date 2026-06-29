<script setup lang="ts">
import StepNav from "./components/StepNav.vue";
</script>

<template>
  <div class="app-shell">
    <StepNav />
    <main class="app-content">
      <RouterView />
    </main>
  </div>
</template>
