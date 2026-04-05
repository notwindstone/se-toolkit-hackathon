<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

type Status = "up" | "down";
type TargetType = "http" | "postgres";

interface Target {
  id: number;
  type: TargetType;
  name: string;
  url: string;
  port: number | null;
  check_interval_seconds: number;
  enabled: boolean;
  created_at: string;
}

interface StatusRow {
  id: number;
  name: string;
  type: TargetType;
  enabled: boolean;
  last_status: Status | null;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  last_error: string | null;
  uptime_percent: number;
}

interface HealthCheck {
  id: number;
  target_id: number;
  status: Status;
  response_time_ms: number | null;
  error: string | null;
  checked_at: string;
}

const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

const statusRows = ref<StatusRow[]>([]);
const targets = ref<Target[]>([]);
const checks = ref<HealthCheck[]>([]);

const selectedTargetId = ref<number | null>(null);

const loadingOverview = ref(true);
const loadingChecks = ref(false);
const overviewError = ref<string | null>(null);
const checksError = ref<string | null>(null);

let refreshHandle: number | null = null;

const selectedTarget = computed(() => {
  if (selectedTargetId.value === null) return null;
  return targets.value.find((target) => target.id === selectedTargetId.value) ?? null;
});

const selectedTargetStatus = computed(() => {
  if (selectedTargetId.value === null) return null;
  return statusRows.value.find((row) => row.id === selectedTargetId.value) ?? null;
});

const totalTargets = computed(() => statusRows.value.length);
const upTargets = computed(() => statusRows.value.filter((row) => row.last_status === "up").length);
const downTargets = computed(() => statusRows.value.filter((row) => row.last_status === "down").length);
const avgUptime = computed(() => {
  if (statusRows.value.length === 0) return 0;
  const sum = statusRows.value.reduce((acc, row) => acc + row.uptime_percent, 0);
  return Math.round((sum / statusRows.value.length) * 100) / 100;
});

async function request<T>(path: string): Promise<T> {
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  const response = await fetch(`${base}${path}`);

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function loadOverview(): Promise<void> {
  loadingOverview.value = true;
  overviewError.value = null;

  try {
    const [status, targetList] = await Promise.all([
      request<StatusRow[]>("/api/status"),
      request<Target[]>("/api/targets"),
    ]);

    statusRows.value = status;
    targets.value = targetList;

    if (status.length === 0) {
      selectedTargetId.value = null;
      checks.value = [];
      return;
    }

    if (selectedTargetId.value === null || !status.some((row) => row.id === selectedTargetId.value)) {
      selectedTargetId.value = status[0].id;
    }
  } catch (error) {
    overviewError.value = error instanceof Error ? error.message : "Failed to load dashboard data.";
  } finally {
    loadingOverview.value = false;
  }
}

async function loadChecks(targetId: number): Promise<void> {
  loadingChecks.value = true;
  checksError.value = null;

  try {
    checks.value = await request<HealthCheck[]>(`/api/targets/${targetId}/checks?limit=20`);
  } catch (error) {
    checksError.value = error instanceof Error ? error.message : "Failed to load target checks.";
  } finally {
    loadingChecks.value = false;
  }
}

function setSelectedTarget(targetId: number): void {
  selectedTargetId.value = targetId;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";

  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusPillClass(status: Status | null): string {
  if (status === "up") return "bg-emerald-500/15 text-emerald-300 border-emerald-600/50";
  if (status === "down") return "bg-rose-500/15 text-rose-300 border-rose-600/50";
  return "bg-gray-700/40 text-gray-300 border-gray-700";
}

watch(selectedTargetId, (targetId) => {
  if (targetId !== null) {
    loadChecks(targetId);
  } else {
    checks.value = [];
  }
});

onMounted(async () => {
  await loadOverview();
  refreshHandle = window.setInterval(loadOverview, 30_000);
});

onBeforeUnmount(() => {
  if (refreshHandle !== null) {
    window.clearInterval(refreshHandle);
  }
});
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur">
      <div class="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="text-2xl font-semibold tracking-tight">
            <span class="text-cyan-400">Yesod</span>
            <span class="ml-2 text-sm font-normal text-slate-400">Monitoring Dashboard</span>
          </h1>
          <div class="flex items-center gap-3 text-xs text-slate-400">
            <span>Refresh: every 30s</span>
            <button
              class="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-cyan-500 hover:text-cyan-300"
              :disabled="loadingOverview"
              @click="loadOverview"
            >
              {{ loadingOverview ? "Refreshing..." : "Refresh now" }}
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div
        v-if="overviewError"
        class="mb-6 rounded-xl border border-rose-600/40 bg-rose-500/10 p-4 text-sm text-rose-200"
      >
        {{ overviewError }}
      </div>

      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p class="text-xs uppercase tracking-wide text-slate-400">Total Targets</p>
          <p class="mt-2 text-2xl font-semibold">{{ totalTargets }}</p>
        </article>
        <article class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p class="text-xs uppercase tracking-wide text-slate-400">Healthy</p>
          <p class="mt-2 text-2xl font-semibold text-emerald-300">{{ upTargets }}</p>
        </article>
        <article class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p class="text-xs uppercase tracking-wide text-slate-400">Failing</p>
          <p class="mt-2 text-2xl font-semibold text-rose-300">{{ downTargets }}</p>
        </article>
        <article class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p class="text-xs uppercase tracking-wide text-slate-400">Average Uptime</p>
          <p class="mt-2 text-2xl font-semibold">{{ avgUptime.toFixed(2) }}%</p>
        </article>
      </section>

      <section class="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div class="rounded-xl border border-slate-800 bg-slate-900/60">
          <div class="border-b border-slate-800 px-4 py-3">
            <h2 class="text-sm font-medium uppercase tracking-wide text-slate-300">Targets</h2>
          </div>

          <div v-if="loadingOverview && totalTargets === 0" class="p-4 text-sm text-slate-400">
            Loading targets...
          </div>

          <div v-else-if="totalTargets === 0" class="p-4 text-sm text-slate-400">
            No targets found yet. Add one via API `POST /api/targets`.
          </div>

          <ul v-else class="divide-y divide-slate-800">
            <li v-for="row in statusRows" :key="row.id">
              <button
                class="w-full px-4 py-3 text-left transition hover:bg-slate-800/70"
                :class="selectedTargetId === row.id ? 'bg-slate-800/70' : ''"
                @click="setSelectedTarget(row.id)"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="font-medium text-slate-100">{{ row.name }}</p>
                    <p class="mt-0.5 text-xs text-slate-400">
                      {{ row.type.toUpperCase() }} • {{ row.enabled ? "Enabled" : "Disabled" }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="rounded-full border px-2 py-1 text-xs"
                      :class="statusPillClass(row.last_status)"
                    >
                      {{ row.last_status ?? "unknown" }}
                    </span>
                    <span class="text-xs text-slate-400">
                      {{ row.uptime_percent.toFixed(2) }}%
                    </span>
                  </div>
                </div>
              </button>
            </li>
          </ul>
        </div>

        <div class="rounded-xl border border-slate-800 bg-slate-900/60">
          <div class="border-b border-slate-800 px-4 py-3">
            <h2 class="text-sm font-medium uppercase tracking-wide text-slate-300">Selected Target</h2>
          </div>

          <div v-if="!selectedTarget || !selectedTargetStatus" class="p-4 text-sm text-slate-400">
            Select a target to inspect recent checks.
          </div>

          <div v-else class="space-y-4 p-4">
            <div>
              <p class="text-lg font-semibold">{{ selectedTarget.name }}</p>
              <p class="mt-1 break-all text-xs text-slate-400">
                {{ selectedTarget.url }}<span v-if="selectedTarget.port">:{{ selectedTarget.port }}</span>
              </p>
            </div>

            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-slate-400">Status</dt>
                <dd class="mt-1">
                  <span
                    class="rounded-full border px-2 py-1 text-xs"
                    :class="statusPillClass(selectedTargetStatus.last_status)"
                  >
                    {{ selectedTargetStatus.last_status ?? "unknown" }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="text-slate-400">Type</dt>
                <dd class="mt-1 font-medium">{{ selectedTarget.type.toUpperCase() }}</dd>
              </div>
              <div>
                <dt class="text-slate-400">Response</dt>
                <dd class="mt-1 font-medium">
                  {{ selectedTargetStatus.last_response_time_ms ?? "-" }} ms
                </dd>
              </div>
              <div>
                <dt class="text-slate-400">Last Check</dt>
                <dd class="mt-1 font-medium">{{ formatDateTime(selectedTargetStatus.last_checked_at) }}</dd>
              </div>
            </dl>

            <p v-if="selectedTargetStatus.last_error" class="rounded-md bg-rose-500/10 p-2 text-xs text-rose-200">
              {{ selectedTargetStatus.last_error }}
            </p>
          </div>
        </div>
      </section>

      <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900/60">
        <div class="border-b border-slate-800 px-4 py-3">
          <h2 class="text-sm font-medium uppercase tracking-wide text-slate-300">Recent Checks (20)</h2>
        </div>

        <div v-if="loadingChecks" class="p-4 text-sm text-slate-400">Loading check history...</div>

        <div
          v-else-if="checksError"
          class="m-4 rounded-md border border-rose-600/40 bg-rose-500/10 p-3 text-sm text-rose-200"
        >
          {{ checksError }}
        </div>

        <div v-else-if="checks.length === 0" class="p-4 text-sm text-slate-400">
          No check history found for this target yet.
        </div>

        <ul v-else class="divide-y divide-slate-800">
          <li v-for="check in checks" :key="check.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="h-2.5 w-2.5 rounded-full" :class="check.status === 'up' ? 'bg-emerald-400' : 'bg-rose-400'" />
              <span class="text-sm font-medium">{{ check.status.toUpperCase() }}</span>
              <span class="text-xs text-slate-400">
                {{ check.response_time_ms ?? "-" }} ms
              </span>
            </div>
            <div class="flex items-center gap-3">
              <span v-if="check.error" class="max-w-sm truncate text-xs text-rose-300">{{ check.error }}</span>
              <time class="text-xs text-slate-400">{{ formatDateTime(check.checked_at) }}</time>
            </div>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
