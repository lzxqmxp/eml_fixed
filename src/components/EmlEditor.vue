<script setup lang="ts">
import { ref, computed } from 'vue'
import { parseEml, buildEml, type EmlData } from '../utils/emlParser'

// ─── State ───────────────────────────────────────────────────────────────────

const filePath = ref<string | null>(null)
const rawEml = ref<string>('')
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const successMsg = ref('')

// Editable fields
const received = ref('')
const date = ref('')
const from = ref('')
const to = ref('')
const subject = ref('')
const textContent = ref('')
const htmlContent = ref('')

// UI state
const activeTab = ref<'text' | 'html' | 'preview'>('text')
const hasFile = computed(() => rawEml.value !== '')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyParsed(data: EmlData) {
  received.value = data.received
  date.value = data.date
  from.value = data.from
  to.value = data.to
  subject.value = data.subject
  textContent.value = data.textContent
  htmlContent.value = data.htmlContent
}

function clearMessages() {
  errorMsg.value = ''
  successMsg.value = ''
}

// ─── IPC actions ─────────────────────────────────────────────────────────────

async function openFile() {
  clearMessages()
  if (!window.ipcRenderer) {
    errorMsg.value = '此功能仅在 Electron 应用中可用'
    return
  }
  loading.value = true
  try {
    const result = await window.ipcRenderer.invoke('dialog:open-eml')
    if (result) {
      filePath.value = result.filePath
      rawEml.value = result.content
      applyParsed(parseEml(result.content))
      successMsg.value = `已打开：${result.filePath}`
    }
  } catch (e) {
    errorMsg.value = `打开失败：${(e as Error).message}`
  } finally {
    loading.value = false
  }
}

async function saveFile() {
  clearMessages()
  if (!hasFile.value) return
  saving.value = true
  try {
    const updated: EmlData = {
      received: received.value,
      date: date.value,
      from: from.value,
      to: to.value,
      subject: subject.value,
      textContent: textContent.value,
      htmlContent: htmlContent.value,
    }
    const newRaw = buildEml(rawEml.value, updated)
    const savedPath = await window.ipcRenderer.invoke('dialog:save-eml', {
      filePath: filePath.value,
      content: newRaw,
    })
    if (savedPath) {
      rawEml.value = newRaw
      filePath.value = savedPath
      successMsg.value = `已保存：${savedPath}`
    }
  } catch (e) {
    errorMsg.value = `保存失败：${(e as Error).message}`
  } finally {
    saving.value = false
  }
}

async function saveAsFile() {
  clearMessages()
  if (!hasFile.value) return
  saving.value = true
  try {
    const updated: EmlData = {
      received: received.value,
      date: date.value,
      from: from.value,
      to: to.value,
      subject: subject.value,
      textContent: textContent.value,
      htmlContent: htmlContent.value,
    }
    const newRaw = buildEml(rawEml.value, updated)
    const savedPath = await window.ipcRenderer.invoke('dialog:save-eml', {
      filePath: null, // force "Save As" dialog
      content: newRaw,
    })
    if (savedPath) {
      rawEml.value = newRaw
      filePath.value = savedPath
      successMsg.value = `已另存为：${savedPath}`
    }
  } catch (e) {
    errorMsg.value = `另存失败：${(e as Error).message}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="eml-editor">
    <!-- ── Toolbar ──────────────────────────────────────────────────────── -->
    <header class="toolbar">
      <span class="app-title">EML 元数据编辑器</span>
      <div class="toolbar-actions">
        <button class="btn btn-primary" :disabled="loading" @click="openFile">
          {{ loading ? '打开中…' : '📂 打开 EML' }}
        </button>
        <button class="btn btn-success" :disabled="!hasFile || saving" @click="saveFile">
          {{ saving ? '保存中…' : '💾 保存' }}
        </button>
        <button class="btn btn-outline" :disabled="!hasFile || saving" @click="saveAsFile">
          另存为…
        </button>
      </div>
      <span v-if="filePath" class="filepath" :title="filePath">{{ filePath }}</span>
    </header>

    <!-- ── Status messages ────────────────────────────────────────────── -->
    <div v-if="errorMsg" class="alert alert-error">⚠️ {{ errorMsg }}</div>
    <div v-if="successMsg" class="alert alert-success">✅ {{ successMsg }}</div>

    <!-- ── Empty state ────────────────────────────────────────────────── -->
    <div v-if="!hasFile" class="empty-state">
      <div class="empty-icon">📧</div>
      <p>点击「打开 EML」按钮选择一个 .eml 文件开始编辑</p>
    </div>

    <!-- ── Editor layout ─────────────────────────────────────────────── -->
    <div v-else class="editor-layout">

      <!-- Left panel: metadata headers -->
      <section class="panel metadata-panel">
        <h2 class="panel-title">邮件元数据</h2>

        <div class="field-group">
          <label class="field-label" for="field-received">Received:</label>
          <textarea
            id="field-received"
            v-model="received"
            class="field-textarea field-monospace"
            rows="4"
            placeholder="每行一条 Received 记录"
          />
        </div>

        <div class="field-group">
          <label class="field-label" for="field-date">Date:</label>
          <input
            id="field-date"
            v-model="date"
            class="field-input"
            type="text"
            placeholder="例：Mon, 13 Mar 2026 10:00:00 +0800"
          />
        </div>

        <div class="field-group">
          <label class="field-label" for="field-from">From:</label>
          <input
            id="field-from"
            v-model="from"
            class="field-input"
            type="text"
            placeholder="发件人地址"
          />
        </div>

        <div class="field-group">
          <label class="field-label" for="field-to">To:</label>
          <input
            id="field-to"
            v-model="to"
            class="field-input"
            type="text"
            placeholder="收件人地址"
          />
        </div>

        <div class="field-group">
          <label class="field-label" for="field-subject">Subject:</label>
          <input
            id="field-subject"
            v-model="subject"
            class="field-input"
            type="text"
            placeholder="邮件主题"
          />
        </div>
      </section>

      <!-- Right panel: body content -->
      <section class="panel content-panel">
        <h2 class="panel-title">邮件正文</h2>

        <div class="tab-bar">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'text' }"
            @click="activeTab = 'text'"
          >纯文本</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'html' }"
            @click="activeTab = 'html'"
          >HTML 源码</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'preview' }"
            @click="activeTab = 'preview'"
          >HTML 预览</button>
        </div>

        <div class="tab-content">
          <textarea
            v-if="activeTab === 'text'"
            v-model="textContent"
            class="body-editor"
            placeholder="纯文本正文内容…"
            spellcheck="false"
          />

          <textarea
            v-if="activeTab === 'html'"
            v-model="htmlContent"
            class="body-editor field-monospace"
            placeholder="HTML 正文源码…"
            spellcheck="false"
          />

          <!-- Sandboxed iframe for safe HTML preview -->
          <iframe
            v-if="activeTab === 'preview'"
            class="html-preview"
            sandbox="allow-same-origin"
            :srcdoc="htmlContent || '<p style=\'color:#888\'>（HTML 正文为空）</p>'"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ─────────────────────────────────────────────────────────────── */
.eml-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--fg);
  font-size: 14px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.app-title {
  font-weight: 700;
  font-size: 15px;
  margin-right: 8px;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.filepath {
  font-size: 12px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400px;
  flex: 1;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.btn {
  padding: 5px 14px;
  border-radius: 5px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s, filter 0.15s;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-primary {
  background: #4a90e2;
  color: #fff;
  border-color: #357abd;
}
.btn-primary:not(:disabled):hover {
  filter: brightness(1.1);
}
.btn-success {
  background: #27ae60;
  color: #fff;
  border-color: #1e8449;
}
.btn-success:not(:disabled):hover {
  filter: brightness(1.1);
}
.btn-outline {
  background: transparent;
  color: var(--fg);
  border-color: var(--border);
}
.btn-outline:not(:disabled):hover {
  background: var(--hover-bg);
}

/* ── Alerts ──────────────────────────────────────────────────────────────── */
.alert {
  padding: 6px 14px;
  font-size: 13px;
  flex-shrink: 0;
}
.alert-error {
  background: #5e1c1c;
  color: #f8c8c8;
  border-bottom: 1px solid #8b2a2a;
}
.alert-success {
  background: #1a4030;
  color: #b2f0cc;
  border-bottom: 1px solid #2d6248;
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--fg-muted);
}
.empty-icon {
  font-size: 56px;
}

/* ── Editor panels ───────────────────────────────────────────────────────── */
.editor-layout {
  flex: 1;
  display: flex;
  min-height: 0;
  gap: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 12px 14px;
}

.metadata-panel {
  width: 340px;
  min-width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.content-panel {
  flex: 1;
  min-width: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-muted);
  margin: 0 0 12px;
  flex-shrink: 0;
}

/* ── Form fields ─────────────────────────────────────────────────────────── */
.field-group {
  margin-bottom: 12px;
}
.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--label-fg);
}
.field-input,
.field-textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--input-bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}
.field-input:focus,
.field-textarea:focus {
  border-color: #4a90e2;
}
.field-monospace {
  font-family: 'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace;
  font-size: 12px;
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
  flex-shrink: 0;
}
.tab-btn {
  padding: 5px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 13px;
  border-radius: 0;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover {
  color: var(--fg);
  border-color: transparent;
}
.tab-btn.active {
  color: #4a90e2;
  border-bottom-color: #4a90e2;
  font-weight: 600;
}

/* ── Body editor / preview ───────────────────────────────────────────────── */
.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.body-editor {
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  min-height: 0;
  resize: none;
  background: var(--input-bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
  line-height: 1.55;
}
.body-editor:focus {
  border-color: #4a90e2;
}
.html-preview {
  flex: 1;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
}

/* ── CSS custom properties (light / dark) ─────────────────────────────────── */
:root {
  --bg: #1e1e2e;
  --toolbar-bg: #18182a;
  --fg: #cdd6f4;
  --fg-muted: #8890a8;
  --label-fg: #a0aec0;
  --border: #2d2d44;
  --input-bg: #13131f;
  --hover-bg: #2a2a40;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f5f6fa;
    --toolbar-bg: #ffffff;
    --fg: #2d3748;
    --fg-muted: #718096;
    --label-fg: #4a5568;
    --border: #e2e8f0;
    --input-bg: #ffffff;
    --hover-bg: #edf2f7;
  }
  .alert-error {
    background: #fff5f5;
    color: #c53030;
    border-color: #fed7d7;
  }
  .alert-success {
    background: #f0fff4;
    color: #276749;
    border-color: #c6f6d5;
  }
}
</style>
