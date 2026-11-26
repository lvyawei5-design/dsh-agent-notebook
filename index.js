/**
 * 记事本 Host 半。
 *
 * 职责：
 * 1. 把记事持久化到当前 profile 的 data/notebook/notebook.json；
 * 2. 注册 `notebook` 工具，让助手能读写记事；
 * 3. 在每次模型步骤组装系统提示时，把「启用中的用户要求 + 最近的助手记录」放进提示；
 * 4. 每个回合结束时，如果这一回合确实动过工具，就把助手的总结自动记成一条大白话；
 * 5. 给左侧栏面板注册取数路由（/api/dsh-notebook/state 与 /action）。
 */
import { readFileSync, renameSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const API = '/api/dsh-notebook'
const BODY_LIMIT = 64 * 1024
const NOTE_TEXT_LIMIT = 4000
const NOTE_HISTORY_LIMIT = 20
const AUTO_NOTE_LIMIT = 120
const AUTO_NOTE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const WORK_CLEANUP_LIMIT = 80
const PROMPT_USER_LIMIT = 40
const PROMPT_AGENT_LIMIT = 10
const PROMPT_TEXT_LIMIT = 8000
const CONVERSATION_LIMIT = 40
const LOG = '[dsh-notebook]'

/** 当前 profile 的数据文件；DSH_PROFILE_DIR 由 profile 启动的 Harness 注入。 */
function dataFilePath() {
  const profileDir = process.env.DSH_PROFILE_DIR
    || path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop')
  return path.join(profileDir, 'data', 'notebook', 'notebook.json')
}

function newId() {
  return `nb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function oneLine(text, limit) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function noteFrom(raw) {
  if (raw === null || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || typeof raw.text !== 'string') return null
  const note = {
    id: raw.id,
    text: raw.text.slice(0, NOTE_TEXT_LIMIT),
    enabled: raw.enabled !== false,
    source: raw.source === 'user' ? 'user' : 'agent',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
  if (raw.auto === true) note.auto = true
  if (raw.pinned === true) note.pinned = true
  if (typeof raw.sessionId === 'string' && raw.sessionId) note.sessionId = raw.sessionId
  if (typeof raw.deletedAt === 'number') note.deletedAt = raw.deletedAt
  const history = Array.isArray(raw.history)
    ? raw.history.filter((entry) => typeof entry === 'string').slice(-NOTE_HISTORY_LIMIT)
    : []
  const future = Array.isArray(raw.future)
    ? raw.future.filter((entry) => typeof entry === 'string').slice(-NOTE_HISTORY_LIMIT)
    : []
  if (history.length > 0) note.history = history
  if (future.length > 0) note.future = future
  return note
}

class NotebookStore {
  constructor(file) {
    this.file = file
    this.notes = []
    this.trash = []
    this.sessions = {}
    this.titles = {}
    this.revision = 0
    this.tail = Promise.resolve()
    this.loadSync()
    const removed = this.cleanupNotes()
    if (removed > 0) void this.persist()
  }

  /** 同步载入，保证第一次系统提示组装就能看到已有记事。 */
  loadSync() {
    let raw
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(`${LOG} 读取记事本失败：`, error)
      return
    }
    try {
      const parsed = JSON.parse(raw)
      this.notes = Array.isArray(parsed?.notes) ? parsed.notes.map(noteFrom).filter(Boolean) : []
      this.trash = Array.isArray(parsed?.trash) ? parsed.trash.map(noteFrom).filter(Boolean) : []
      this.sessions = parsed?.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
        ? parsed.sessions
        : {}
      this.revision = typeof parsed?.revision === 'number' ? parsed.revision : 0
    } catch (error) {
      // 坏文件先留档，绝不直接覆盖。
      console.warn(`${LOG} 记事本文件解析失败，已备份原文件：`, error)
      try {
        renameSync(this.file, `${this.file}.broken-${Date.now()}`)
      } catch {}
      this.notes = []
      this.trash = []
      this.sessions = {}
    }
  }

  /** 串行、原子地保存；多个会话同时写入时不会互相截断。 */
  persist() {
    this.revision += 1
    const snapshot = JSON.stringify({
      version: 1,
      revision: this.revision,
      notes: this.notes,
      trash: this.trash,
      sessions: this.sessions,
    }, null, 2)
    const run = async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      await writeFile(temp, snapshot, 'utf8')
      await rename(temp, this.file)
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch((error) => console.warn(`${LOG} 保存记事本失败：`, error))
    return next
  }

  find(id) {
    return this.notes.find((note) => note.id === id)
  }

  /** 自动记录只留最近 30 天、最多 120 条；用户写的和置顶的永不自动清理。 */
  pruneAutoNotes() {
    const cutoff = Date.now() - AUTO_NOTE_RETENTION_MS
    this.notes = this.notes.filter((note) => !(note.auto === true && note.pinned !== true && note.createdAt < cutoff))
    const autoNotes = this.notes.filter((note) => note.auto === true && note.pinned !== true)
    if (autoNotes.length <= AUTO_NOTE_LIMIT) return
    const remove = new Set(autoNotes.slice(0, autoNotes.length - AUTO_NOTE_LIMIT).map((note) => note.id))
    this.notes = this.notes.filter((note) => !remove.has(note.id))
  }

  cleanupNotes() {
    const before = this.notes.length
    this.pruneAutoNotes()
    return before - this.notes.length
  }

  async add({ text, source, sessionId, auto, pinned }) {
    const now = Date.now()
    const note = {
      id: newId(),
      text: String(text || '').trim().slice(0, NOTE_TEXT_LIMIT),
      enabled: true,
      source: source === 'user' ? 'user' : 'agent',
      createdAt: now,
      updatedAt: now,
    }
    if (auto === true) note.auto = true
    if (pinned === true) note.pinned = true
    if (sessionId) note.sessionId = sessionId
    this.notes.unshift(note)
    this.pruneAutoNotes()
    await this.persist()
    return note
  }

  async setEnabled(id, enabled) {
    const note = this.find(id)
    if (note === undefined) return null
    note.enabled = enabled !== false
    note.updatedAt = Date.now()
    await this.persist()
    return note
  }

  async setPinned(id, pinned) {
    const note = this.find(id)
    if (note === undefined) return null
    const next = pinned === true
    if (note.pinned === next) return note
    if (next) note.pinned = true
    else delete note.pinned
    note.updatedAt = Date.now()
    await this.persist()
    return note
  }

  async setText(id, text) {
    const note = this.find(id)
    if (note === undefined) return null
    const value = String(text || '').trim().slice(0, NOTE_TEXT_LIMIT)
    if (!value) return null
    if (value === note.text) return note
    note.history = [...(note.history || []), note.text].slice(-NOTE_HISTORY_LIMIT)
    note.future = []
    note.text = value
    note.updatedAt = Date.now()
    await this.persist()
    return note
  }

  /** 撤回上一次改动；可以连续撤回，最多保留 NOTE_HISTORY_LIMIT 步。 */
  async undoText(id) {
    const note = this.find(id)
    if (note === undefined) return null
    const history = note.history || []
    if (history.length === 0) return null
    const previous = history[history.length - 1]
    note.history = history.slice(0, -1)
    note.future = [...(note.future || []), note.text].slice(-NOTE_HISTORY_LIMIT)
    note.text = previous
    note.updatedAt = Date.now()
    await this.persist()
    return note
  }

  /** 重做刚撤回的改动。 */
  async redoText(id) {
    const note = this.find(id)
    if (note === undefined) return null
    const future = note.future || []
    if (future.length === 0) return null
    const next = future[future.length - 1]
    note.future = future.slice(0, -1)
    note.history = [...(note.history || []), note.text].slice(-NOTE_HISTORY_LIMIT)
    note.text = next
    note.updatedAt = Date.now()
    await this.persist()
    return note
  }

  /** 删除 = 移入回收站，可恢复。 */
  async remove(id) {
    const index = this.notes.findIndex((note) => note.id === id)
    if (index < 0) return null
    const [note] = this.notes.splice(index, 1)
    const deleted = { ...note, deletedAt: Date.now() }
    this.trash.unshift(deleted)
    await this.persist()
    return deleted
  }

  async restore(id) {
    const index = this.trash.findIndex((note) => note.id === id)
    if (index < 0) return null
    const [note] = this.trash.splice(index, 1)
    delete note.deletedAt
    note.updatedAt = Date.now()
    this.notes.unshift(note)
    await this.persist()
    return note
  }

  async purge(id) {
    const index = this.trash.findIndex((note) => note.id === id)
    if (index < 0) return false
    this.trash.splice(index, 1)
    await this.persist()
    return true
  }

  sessionEnabled(id) {
    const entry = this.sessions[id]
    return entry === undefined || entry.enabled !== false
  }

  async setSession(id, enabled) {
    this.sessions[id] = {
      ...(this.sessions[id] || {}),
      enabled: enabled !== false,
      updatedAt: Date.now(),
    }
    await this.persist()
    return this.sessions[id]
  }

  /** 面板「对话」页的数据：最近的顶层会话 + 各自的记事本开关。 */
  async conversations(sessionQuery) {
    const rows = []
    const seen = new Set()
    if (sessionQuery && typeof sessionQuery.listSessions === 'function') {
      let records = []
      try {
        records = await sessionQuery.listSessions()
      } catch (error) {
        console.warn(`${LOG} 读取会话列表失败：`, error)
      }
      for (const record of records) {
        const header = record?.header
        if (!header || typeof header.id !== 'string' || seen.has(header.id)) continue
        if (header.origin === 'subagent') continue
        seen.add(header.id)
        rows.push({
          id: header.id,
          title: this.titles[header.id] || '',
          cwd: typeof header.cwd === 'string' ? header.cwd : '',
          createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
          enabled: this.sessionEnabled(header.id),
        })
        if (rows.length >= CONVERSATION_LIMIT) break
      }
      const missing = rows.filter((row) => !row.title).map((row) => row.id)
      if (missing.length > 0 && typeof sessionQuery.readTitleSnapshots === 'function') {
        try {
          const results = await sessionQuery.readTitleSnapshots(missing)
          for (const result of results) {
            if (result?.status !== 'fulfilled') continue
            const title = result.value?.title?.title
            if (typeof title === 'string' && title) {
              this.titles[result.sessionId] = title
              const row = rows.find((candidate) => candidate.id === result.sessionId)
              if (row) row.title = title
            }
          }
        } catch (error) {
          console.warn(`${LOG} 读取会话标题失败：`, error)
        }
      }
    }
    // 即使会话已经不在当前语料里，也保留用户做过的选择，方便取消/恢复。
    for (const [id, entry] of Object.entries(this.sessions)) {
      if (seen.has(id)) continue
      rows.push({
        id,
        title: this.titles[id] || '',
        cwd: '',
        createdAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
        enabled: entry.enabled !== false,
      })
    }
    return rows
  }
}

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  })
}

function failure(message) {
  return respond({ ok: false, error: { code: 'notebook', message } })
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new Error('请求内容太大')
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > BODY_LIMIT) throw new Error('请求内容太大')
  if (text.trim() === '') throw new Error('请求内容为空')
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容必须是对象')
  return value
}

async function stateOf(ctx, store) {
  return {
    revision: store.revision,
    notes: store.notes,
    trash: store.trash,
    conversations: await store.conversations(ctx.get('sessionQuery')),
  }
}

/** 面板写操作。所有写操作都回一份最新的完整状态，前端不需要再跑一次读。 */
async function applyPanelAction(store, body) {
  const action = typeof body.action === 'string' ? body.action : ''
  const id = typeof body.id === 'string' ? body.id : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  switch (action) {
    case 'add': {
      if (!text) throw new Error('先写点内容再记下来')
      // 用户亲手写的默认置顶，可以点图钉取消。
      return { note: await store.add({ text, source: 'user', pinned: true }) }
    }
    case 'toggle':
    case 'update': {
      if (action === 'update') {
        if (!text) throw new Error('内容不能为空')
        const note = await store.setText(id, text)
        if (note === null) throw new Error('找不到这条记事')
        return { note }
      }
      const note = await store.setEnabled(id, body.enabled !== false)
      if (note === null) throw new Error('找不到这条记事')
      return { note }
    }
    case 'delete': {
      const note = await store.remove(id)
      if (note === null) throw new Error('找不到这条记事')
      return { note }
    }
    case 'undo': {
      const note = await store.undoText(id)
      if (note === null) throw new Error('没有可撤回的更改')
      return { note }
    }
    case 'redo': {
      const note = await store.redoText(id)
      if (note === null) throw new Error('没有可重做的更改')
      return { note }
    }
    case 'pin': {
      const note = await store.setPinned(id, body.pinned === true)
      if (note === null) throw new Error('找不到这条记事')
      return { note }
    }
    case 'cleanup': {
      const removed = store.cleanupNotes()
      if (removed > 0) await store.persist()
      return { removed }
    }
    case 'restore': {
      const note = await store.restore(id)
      if (note === null) throw new Error('回收站里没有这条记事')
      return { note }
    }
    case 'purge': {
      const ok = await store.purge(id)
      if (!ok) throw new Error('回收站里没有这条记事')
      return {}
    }
    case 'session': {
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      if (!sessionId) throw new Error('缺少对话 id')
      return { session: await store.setSession(sessionId, body.enabled !== false) }
    }
    default:
      throw new Error(`未知操作：${action || '(空)'}`)
  }
}

function registerRoutes(ctx, store) {
  const connection = ctx.get('connection')
  if (!connection || typeof connection.fetch?.register !== 'function') {
    console.warn(`${LOG} connection 服务不可用，左侧栏面板没有取数通道`)
    return () => {}
  }
  const disposers = [
    connection.fetch.register({
      path: `${API}/state`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return respond({ ok: true, value: await stateOf(ctx, store) })
        } catch (error) {
          return failure(String(error?.message || error))
        }
      },
    }),
    connection.fetch.register({
      path: `${API}/action`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readJsonBody(request)
          const result = await applyPanelAction(store, body)
          return respond({ ok: true, value: await stateOf(ctx, store), result })
        } catch (error) {
          return failure(String(error?.message || error))
        }
      },
    }),
  ]
  return async () => {
    for (const dispose of disposers.reverse()) {
      try {
        await dispose()
      } catch {}
    }
  }
}

/** 系统提示里的一段记事本；没有启用内容时只留下「怎么记」的说明。 */
function appendPromptNotes(lines, title, entries, formatLine) {
  if (entries.length === 0) return
  lines.push('', title)
  let added = 0
  for (const note of entries) {
    const line = formatLine(note, added + 1)
    // 先保住前面的使用说明和记录要求；记事太多时只展开能放下的部分。
    if (lines.join('\n').length + line.length + 1 > PROMPT_TEXT_LIMIT - 160) break
    lines.push(line)
    added += 1
  }
  if (added < entries.length) lines.push(`- …还有 ${entries.length - added} 条没有展开`)
}

function promptText(store, agent) {
  const sessionId = agent && typeof agent.id === 'string' ? agent.id : undefined
  const enabled = sessionId === undefined || store.sessionEnabled(sessionId)
  const lines = ['# 记事本（跨对话的长期记忆）']
  if (!enabled) {
    lines.push('', '用户已经把本对话的记事本关掉了。这次工作不要引用记事本里的内容，也不要把新内容记进记事本。')
    return lines.join('\n')
  }
  lines.push(
    '',
    '你有一个 `notebook` 工具，它和左侧栏的「记事本」是同一个本子。用户写下的要求是长期偏好，用户亲手写的记事默认置顶；每次工作都要先看、要遵守，置顶的最优先。你自己记下的内容可供参考。',
    '',
    '## 记录要求',
    '你自己判断什么值得记：关键决定、用户偏好、重要结果、做出来的文件/插件/地址。一次最多 1-2 条，用一句话写清“什么重要 + 在哪里”，不要写过程细节；细节下次重新跑即可。普通聊天、只查询、只跑命令看结果，不记。不要记密码、令牌等敏感信息。',
    '',
    '## 清理要求',
    '工作结束后，用 `notebook` 工具 action=cleanup 清理这次产生的临时文件、测试脚本、缓存和构建产物：先不带 confirm 看一眼列表，确认是临时东西再带 confirm=true。只清临时/缓存/构建产物，不删源码、交付物、用户文件。记事本里过时的自动记录会自己清，不用你管。',
  )
  const userNotes = store.notes
    .filter((note) => note.enabled && note.source === 'user')
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    .slice(0, PROMPT_USER_LIMIT)
  const agentNotes = store.notes
    .filter((note) => note.enabled && note.source === 'agent')
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    .slice(0, PROMPT_AGENT_LIMIT)
  if (userNotes.length > 0) {
    appendPromptNotes(lines, '## 用户写下的要求（优先遵守）', userNotes, (note, index) => `${index}. ${note.pinned ? '[置顶] ' : ''}${oneLine(note.text, 500)}`)
  } else {
    lines.push('', '目前用户还没有写下长期要求。')
  }
  appendPromptNotes(lines, '## 你最近记下的事（参考）', agentNotes, (note) => `- ${note.pinned ? '[置顶] ' : ''}${oneLine(note.text, 300)}`)
  const text = lines.join('\n')
  return text.length > PROMPT_TEXT_LIMIT ? `${text.slice(0, PROMPT_TEXT_LIMIT)}\n…（记事本内容过长，已截断）` : text
}

function isNotebookAdd(argumentsText) {
  try {
    const args = JSON.parse(argumentsText)
    return args && args.action === 'add'
  } catch {
    return false
  }
}

const lastAutoTurn = new Map()

function isWindowsLocation(value) {
  return /^[A-Za-z]:\\/.test(value) || /^\\\\/.test(value)
}

function normalizeLocation(value) {
  let text = String(value || '').trim()
  text = text.replace(/^["'`<]+/, '').replace(/["'`>]+$/, '')
  text = text.replace(/[.,;:!?，。；：！？）】》]+$/, '')
  return text
}

function addLocation(list, value) {
  const text = normalizeLocation(value)
  if (!text) return
  if (!isWindowsLocation(text) && !/^https?:\/\//i.test(text)) return
  const key = text.toLowerCase()
  if (list.some((item) => item.toLowerCase() === key)) return
  list.push(text)
}

/** 两三个文件在同一个目录时，记目录比记每个文件更有用。 */
function commonDirectory(paths) {
  const split = paths.map((value) => value.split('\\'))
  const length = Math.min(...split.map((parts) => parts.length))
  let end = 0
  while (end < length && split.every((parts) => parts[end].toLowerCase() === split[0][end].toLowerCase())) end += 1
  if (end < 2) return null
  const common = split[0].slice(0, end).join('\\')
  return common.length > 3 ? common : null
}

/** 把收尾那段话压成一句短标题，去掉 Markdown 和链接。 */
function summarySentence(text, limit) {
  const value = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = value.split(/[。！？!?]/)[0] || value
  return oneLine(sentence, limit)
}

/** 只收「写出来的文件、交付物、安装的插件」，不收普通编辑和读文件。 */
function toolLocations(toolCalls) {
  const locations = []
  for (const item of toolCalls) {
    if (item.name !== 'write' && item.name !== 'present' && item.name !== 'plugin_manager') continue
    let args
    try {
      args = JSON.parse(item.arguments)
    } catch {
      continue
    }
    if (item.name === 'write') {
      addLocation(locations, args?.file_path || args?.path)
    } else if (item.name === 'present' && Array.isArray(args?.files)) {
      for (const file of args.files) addLocation(locations, typeof file === 'string' ? file : file?.path)
    } else if (item.name === 'plugin_manager' && args?.action === 'install_bundle') {
      addLocation(locations, args.target)
    }
  }
  return locations
}

/** 命令跑出来的东西，收尾里明确写了 Windows 路径的，也收。 */
function textLocations(text) {
  const locations = []
  const value = String(text || '')
  for (const match of value.matchAll(/"([A-Za-z]:\\[^"]+)"/g)) addLocation(locations, match[1])
  for (const match of value.matchAll(/'([A-Za-z]:\\[^']+)'/g)) addLocation(locations, match[1])
  for (const match of value.matchAll(/(?<!["'`])([A-Za-z]:\\[^\s"'`<>|]+)/g)) addLocation(locations, match[1])
  return locations
}

function artifactLocations(toolCalls, assistantText) {
  let locations = toolLocations(toolCalls)
  if (locations.length === 0) locations = textLocations(assistantText)
  const windows = locations.filter(isWindowsLocation)
  if (windows.length >= 2) {
    const common = commonDirectory(windows)
    if (common) locations = [common, ...locations.filter((value) => !isWindowsLocation(value))]
  }
  return locations.slice(0, 3)
}

/**
 * 一回合结束后，只在确实留下了文件/插件/地址时记一条简短的位置记录。
 * 普通聊天、只读、只跑命令看结果、没有留下东西的工作，一律不记。
 * 如果助手收尾时已经主动调用 notebook add，就不再自动记。
 */
async function autoRecord(store, session, event) {
  if (!event || event.type !== 'turn/end') return
  const reason = event.data && event.data.reason
  if (!reason || reason.kind !== 'completed') return
  const header = session && session.header
  if (!header || typeof header.id !== 'string' || header.origin === 'subagent') return
  // 用户把这个对话的记事本关掉后，自动记录也不该继续写。
  if (!store.sessionEnabled(header.id)) return
  const turn = event.data.turn
  if (lastAutoTurn.get(header.id) === turn) return
  let events
  try {
    events = session.snapshotEvents(0, session.seq)
  } catch {
    return
  }
  const turnEvents = events.filter((item) => item && item.data && typeof item.data === 'object' && item.data.turn === turn)
  const toolCalls = turnEvents.filter((item) => item.type === 'tool/call')
  if (toolCalls.length === 0) return
  // 只有「收尾时主动记了一条」才跳过自动记录；中途记的笔记不算工作总结。
  const notebookAdds = toolCalls.filter((item) => item.name === 'notebook' && isNotebookAdd(item.arguments))
  if (notebookAdds.length > 0) {
    const lastAddIndex = toolCalls.lastIndexOf(notebookAdds[notebookAdds.length - 1])
    if (lastAddIndex >= toolCalls.length - 3) {
      lastAutoTurn.set(header.id, turn)
      return
    }
  }
  let assistantText = ''
  for (let index = turnEvents.length - 1; index >= 0; index -= 1) {
    const item = turnEvents[index]
    if (item.type !== 'assistant/message') continue
    const content = item.data && item.data.message && item.data.message.content
    if (!Array.isArray(content)) continue
    const text = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (text) {
      assistantText = text
      break
    }
  }
  const locations = artifactLocations(toolCalls, assistantText)
  if (locations.length === 0) return
  const subject = summarySentence(assistantText, 60)
  const text = (subject ? `${subject} 位置：${locations.join('；')}` : `位置：${locations.join('；')}`).slice(0, 320)
  lastAutoTurn.set(header.id, turn)
  await store.add({
    text,
    source: 'agent',
    sessionId: header.id,
    auto: true,
  })
}

const WORK_CLEANUP_DIRS = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache'])
const WORK_CLEANUP_BUILDS = new Set(['dist', 'build', 'target', 'coverage', '.next', 'out'])

function isDisposableName(name, isDirectory, includeBuilds) {
  if (isDirectory) {
    if (WORK_CLEANUP_DIRS.has(name)) return true
    return includeBuilds === true && WORK_CLEANUP_BUILDS.has(name)
  }
  return /\.(tmp|temp|log|bak|old|swp|pyc|tsbuildinfo)$/i.test(name)
    || name === 'Thumbs.db'
    || name === '.DS_Store'
}

/**
 * 只清工作目录里的临时/缓存/（可选）构建产物。
 * 不碰源码、交付物、.git、node_modules，也不碰用户手写文件。
 * 默认 dry-run，只有 confirm=true 才真的删；目录必须是绝对路径。
 */
async function cleanupWorkDirectory(directory, options = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('directory 必须是绝对路径')
  }
  const root = path.resolve(directory)
  const rootInfo = await stat(root)
  if (!rootInfo.isDirectory()) throw new Error('directory 不是文件夹')
  const confirm = options.confirm === true
  const includeBuilds = options.includeBuilds === true
  const olderThanDays = Number.isFinite(options.olderThanDays) && options.olderThanDays >= 0
    ? options.olderThanDays
    : 7
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  const candidates = []
  let visited = 0

  async function walk(current, depth) {
    if (depth > 6 || visited > 5000 || candidates.length >= WORK_CLEANUP_LIMIT) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (candidates.length >= WORK_CLEANUP_LIMIT) return
      if (entry.isSymbolicLink()) continue
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const full = path.join(current, entry.name)
      const isDirectory = entry.isDirectory()
      if (isDisposableName(entry.name, isDirectory, includeBuilds)) {
        let info
        try {
          info = await stat(full)
        } catch {
          continue
        }
        if (info.mtimeMs >= cutoff) continue
        candidates.push({ path: full, directory: isDirectory, bytes: info.size })
        continue
      }
      visited += 1
      if (isDirectory) await walk(full, depth + 1)
    }
  }

  await walk(root, 0)
  const preview = candidates.slice(0, 20).map((candidate) => `- ${candidate.path}`).join('\n')
  const more = candidates.length > 20 ? `\n…还有 ${candidates.length - 20} 项` : ''
  if (!confirm) {
    return {
      ok: true,
      mode: 'dry-run',
      root,
      count: candidates.length,
      candidates,
      message: candidates.length === 0
        ? '没有发现需要清理的临时文件。'
        : `发现 ${candidates.length} 个可清理项（还没删）：\n${preview}${more}\n确认后带 confirm=true 再执行。`,
    }
  }
  const removed = []
  for (const candidate of candidates) {
    try {
      await rm(candidate.path, { recursive: candidate.directory, force: true })
      removed.push(candidate.path)
    } catch {}
  }
  return {
    ok: true,
    mode: 'purged',
    root,
    count: removed.length,
    removed,
    message: removed.length === 0
      ? '没有可清理的项。'
      : `已清理 ${removed.length} 个临时/缓存项：\n${removed.slice(0, 20).map((value) => `- ${value}`).join('\n')}${removed.length > 20 ? `\n…还有 ${removed.length - 20} 项` : ''}`,
  }
}

function createNotebookTool(store) {
  const listMessage = () => {
    const lines = []
    const ordered = [...store.notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    if (ordered.length === 0) {
      lines.push('记事本现在是空的。')
    } else {
      const enabled = ordered.filter((note) => note.enabled).length
      lines.push(`记事本共 ${ordered.length} 条（启用 ${enabled} 条）：`)
      ordered.forEach((note, index) => {
        const source = note.source === 'user' ? '用户' : note.auto === true ? '助手自动' : '助手'
        const pinned = note.pinned === true ? '[置顶]' : ''
        lines.push(`${index + 1}. [${note.enabled ? '✓' : '×'}][${source}]${pinned} ${oneLine(note.text, 300)}（id: ${note.id}）`)
      })
    }
    if (store.trash.length > 0) lines.push('', `回收站里还有 ${store.trash.length} 条已删除的记事。`)
    return { ok: true, notes: ordered, trash: store.trash, message: lines.join('\n') }
  }
  return {
    name: 'notebook',
    description: '读写用户的本地记事本，并清理过时记录或工作目录里的临时文件。你自己判断什么值得记：关键决定、用户偏好、重要结果、文件/插件/地址。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'update', 'undo', 'redo', 'toggle', 'pin', 'delete', 'restore', 'purge', 'session', 'cleanup'],
          description: '要做什么。list 读取；add 新增；update 改一条；undo 撤回；redo 重做；toggle 勾选/收起；pin 置顶/取消置顶；delete 移入回收站；restore 恢复；purge 彻底删除；session 切换对话；cleanup 清理旧自动记录；带 directory 时清理工作目录里的临时/缓存文件。',
        },
        text: { type: 'string', description: 'add / update 的正文。简要写清“什么重要 + 在哪里”，不要写过程细节。' },
        id: { type: 'string', description: '目标记事 id（update / undo / redo / toggle / pin / delete / restore / purge 需要）。' },
        enabled: { type: 'boolean', description: 'toggle 或 session 时为 true 表示带上，false 表示收起。' },
        pinned: { type: 'boolean', description: 'pin 时为 true 表示置顶，false 表示取消置顶。' },
        sessionId: { type: 'string', description: 'session 操作要切换的对话 id。' },
        directory: { type: 'string', description: 'cleanup 时可选的工作目录绝对路径；不填只清理记事本里的旧自动记录。' },
        confirm: { type: 'boolean', description: 'cleanup 工作目录时，false/省略先列出可清理项（dry-run），true 才真的删。' },
        includeBuilds: { type: 'boolean', description: 'cleanup 工作目录时是否把 dist/build/target/coverage 等构建产物也算进去；默认 false。' },
        olderThanDays: { type: 'number', description: 'cleanup 工作目录时只清超过这么多天的项；默认 7。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const text = value && typeof value === 'object' && typeof value.message === 'string'
          ? value.message
          : JSON.stringify(value)
        return [{ type: 'text', text }]
      },
    },
    async execute(args, exec) {
      const action = String(args?.action || '')
      const sessionId = exec.agent?.id
      if ((action === 'list' || action === 'add') && sessionId && !store.sessionEnabled(sessionId)) {
        return { ok: false, message: '本对话的记事本已被用户关闭，不要读取或记录记事。' }
      }
      try {
        switch (action) {
          case 'list':
            return listMessage()
          case 'add': {
            const text = String(args?.text || '').trim()
            if (!text) return { ok: false, message: 'text 不能为空。' }
            const note = await store.add({ text, source: 'agent', sessionId: exec.agent?.id })
            return { ok: true, note, message: `已记下：${note.text}` }
          }
          case 'update': {
            const note = await store.setText(String(args?.id || ''), args?.text)
            if (note === null) return { ok: false, message: '找不到这条记事，或者新内容为空。' }
            return { ok: true, note, message: `已改成：${note.text}` }
          }
          case 'undo': {
            const note = await store.undoText(String(args?.id || ''))
            if (note === null) return { ok: false, message: '没有可撤回的更改。' }
            return { ok: true, note, message: `已撤回：${note.text}` }
          }
          case 'redo': {
            const note = await store.redoText(String(args?.id || ''))
            if (note === null) return { ok: false, message: '没有可重做的更改。' }
            return { ok: true, note, message: `已重做：${note.text}` }
          }
          case 'toggle': {
            const note = await store.setEnabled(String(args?.id || ''), args?.enabled !== false)
            if (note === null) return { ok: false, message: '找不到这条记事。' }
            return { ok: true, note, message: `已${note.enabled ? '带上' : '收起'}：${note.text}` }
          }
          case 'pin': {
            const note = await store.setPinned(String(args?.id || ''), args?.pinned === true)
            if (note === null) return { ok: false, message: '找不到这条记事。' }
            return { ok: true, note, message: `已${note.pinned ? '置顶' : '取消置顶'}：${note.text}` }
          }
          case 'delete': {
            const note = await store.remove(String(args?.id || ''))
            if (note === null) return { ok: false, message: '找不到这条记事。' }
            return { ok: true, note, message: `已移入回收站：${note.text}` }
          }
          case 'restore': {
            const note = await store.restore(String(args?.id || ''))
            if (note === null) return { ok: false, message: '回收站里没有这条记事。' }
            return { ok: true, note, message: `已恢复：${note.text}` }
          }
          case 'purge': {
            const ok = await store.purge(String(args?.id || ''))
            return ok
              ? { ok: true, message: '已彻底删除。' }
              : { ok: false, message: '回收站里没有这条记事。' }
          }
          case 'cleanup': {
            const directory = typeof args?.directory === 'string' ? args.directory : ''
            if (!directory) {
              const removed = store.cleanupNotes()
              if (removed > 0) await store.persist()
              return { ok: true, removed, message: removed > 0 ? `已清掉 ${removed} 条过时的自动记录。` : '没有需要清理的自动记录。' }
            }
            return cleanupWorkDirectory(directory, {
              confirm: args?.confirm === true,
              includeBuilds: args?.includeBuilds === true,
              olderThanDays: Number(args?.olderThanDays),
            })
          }
          case 'session': {
            const sessionId = String(args?.sessionId || '')
            if (!sessionId) return { ok: false, message: 'sessionId 不能为空。' }
            const entry = await store.setSession(sessionId, args?.enabled !== false)
            return {
              ok: true,
              session: { sessionId, enabled: entry.enabled !== false },
              message: `对话 ${sessionId} 的记事本已${entry.enabled !== false ? '打开' : '关闭'}。`,
            }
          }
          default:
            return { ok: false, message: `未知 action：${action || '(空)'}` }
        }
      } catch (error) {
        return { ok: false, message: `记事本操作失败：${String(error?.message || error)}` }
      }
    },
  }
}

export const inject = ['systemPrompt', 'tools']

export function apply(ctx) {
  const store = new NotebookStore(dataFilePath())

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'notebook:memory',
    // 放在团队/计划策略之后、工具说明之前；每次模型步骤都会重新求值。
    order: 640,
    // 用户记事里可能出现 {{...}}，绝不能交给提示变量插值。
    interpolate: false,
    text: (context) => promptText(store, context?.agent),
  }))

  ctx.effect(() => ctx.tools.register(createNotebookTool(store)))

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    void autoRecord(store, session, event).catch((error) => console.warn(`${LOG} 自动记录失败：`, error))
  }))

  ctx.effect(() => registerRoutes(ctx, store))
}
