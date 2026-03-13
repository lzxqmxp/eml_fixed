<script setup lang="ts">
import EmlEditor from './components/EmlEditor.vue'
</script>

<template>
  <EmlEditor />
</template>

<style>
*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}
</style>
