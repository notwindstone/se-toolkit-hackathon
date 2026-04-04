<script setup lang="ts">
const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <!-- Header -->
    <header class="border-b border-gray-800 px-6 py-4">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <h1 class="text-xl font-bold tracking-tight">
          <span class="text-blue-400">Yesod</span>
          <span class="text-gray-500 font-normal text-sm ml-2">Monitoring Dashboard</span>
        </h1>
        <span class="text-xs text-gray-600">API: {{ apiBase }}</span>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-6xl mx-auto px-6 py-12">
      <div class="text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 mb-6">
          <svg class="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h2 class="text-2xl font-semibold mb-2">Dashboard Coming Soon</h2>
        <p class="text-gray-500 max-w-md mx-auto">
          The web dashboard is under construction. Use the Telegram bot for now — 
          send <code class="bg-gray-800 px-1.5 py-0.5 rounded text-sm text-blue-400">/status</code> 
          to check your monitored targets.
        </p>
      </div>

      <!-- API Endpoints Reference -->
      <div class="mt-16 max-w-2xl mx-auto">
        <h3 class="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Available API Endpoints</h3>
        <div class="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
          <div class="px-4 py-3 flex items-center justify-between">
            <code class="text-sm text-blue-300">GET /api/targets</code>
            <span class="text-xs text-gray-600">List all targets</span>
          </div>
          <div class="px-4 py-3 flex items-center justify-between">
            <code class="text-sm text-blue-300">POST /api/targets</code>
            <span class="text-xs text-gray-600">Add a target</span>
          </div>
          <div class="px-4 py-3 flex items-center justify-between">
            <code class="text-sm text-blue-300">GET /api/status</code>
            <span class="text-xs text-gray-600">Current status overview</span>
          </div>
          <div class="px-4 py-3 flex items-center justify-between">
            <code class="text-sm text-blue-300">GET /api/targets/:id/checks</code>
            <span class="text-xs text-gray-600">Check history</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
