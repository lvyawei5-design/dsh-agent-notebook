/**
 * 记事本 Client 半。
 *
 * 左侧栏入口注册在 `sidebar.panellist`，中央面板注册在 `main`（同一个 id 配对）。
 * 数据通过 Host 的 /api/dsh-notebook 路由读取；没有直接 import 任何 Host 包。
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-notebook',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-notebook'
    const API = '/api/dsh-notebook'
    const PANEL_ID = 'dsh-notebook'
    let localeService = null

    const DICT_EN = {
      'panel.title': 'Notebook',
      'panel.subtitle': 'What the assistant did is recorded here in plain language. Everything you write here is read before each task.',
      'tabs.notes': 'Notes',
      'tabs.sessions': 'Conversations',
      'tabs.trash': 'Deleted',
      'notes.placeholder': 'e.g. This software can be used freely, no need to ask every time',
      'notes.add': 'Add note',
      'notes.composeHint': 'Ctrl+Enter to save · up to 4000 characters',
      'notes.count': '{count} notes, {enabled} checked',
      'notes.empty': 'Nothing here yet. Write a note above, or let the assistant record its work.',
      'notes.loadFailed': 'The notebook could not be read. Check the error above and retry.',
      'notes.source.user': 'You',
      'notes.source.agent': 'Assistant',
      'notes.source.auto': 'Auto-recorded',
      'notes.enabledAria': 'Included in the notebook',
      'notes.disabledAria': 'Hidden from the notebook',
      'notes.toggleHint': 'Checked: the assistant sees this before each task',
      'notes.disabledNote': 'hidden',
      'notes.delete': 'Move to deleted',
      'notes.edit': 'Edit',
      'notes.save': 'Save',
      'notes.cancel': 'Cancel',
      'notes.undo': 'Undo',
      'notes.redo': 'Redo',
      'notes.undoHint': 'Undo the last edit ({count} step(s) available)',
      'notes.redoHint': 'Redo the undone edit ({count} step(s) available)',
      'notes.editHint': 'Ctrl+Enter to save · Esc to cancel',
      'notes.historyCount': '{count} undo step(s)',
      'notes.loading': 'Reading the notebook…',
      'sessions.hint': 'Checked conversations let the assistant read this notebook before work; unchecked ones do not.',
      'sessions.empty': 'No conversations to show yet.',
      'sessions.untitled': 'Untitled conversation',
      'sessions.enabled': 'uses notebook',
      'sessions.disabled': 'does not use notebook',
      'trash.hint': 'Deleted notes stay here until purged; restored notes go back to the notebook.',
      'trash.empty': 'No deleted notes.',
      'trash.restore': 'Restore',
      'trash.purge': 'Delete forever',
      'trash.confirmPurge': 'Delete this note permanently? This cannot be undone.',
      'trash.deletedAt': 'Deleted',
      'common.refresh': 'Refresh',
      'common.retry': 'Retry',
      'footer': 'Stored only on this computer. The notebook is read before each task.',
      'error.prefix': 'Notebook error: ',
    }

    const DICT_ZH = {
      'panel.title': '记事本',
      'panel.subtitle': '它做过的事会记在这里，用大白话写。你写下的内容，它每次动手前都会先看一遍。',
      'tabs.notes': '记事',
      'tabs.sessions': '对话',
      'tabs.trash': '已删除',
      'notes.placeholder': '比如：这个软件可以随便用，不用每次问我',
      'notes.add': '记下来',
      'notes.composeHint': 'Ctrl+Enter 保存 · 最多 4000 字',
      'notes.count': '共 {count} 条记事，其中 {enabled} 条勾选中',
      'notes.empty': '记事本还是空的。上面写一条，或者等助手做完事自己记。',
      'notes.loadFailed': '记事本没读出来。看看上面的错误，然后重试。',
      'notes.source.user': '你写的',
      'notes.source.agent': '它记的',
      'notes.source.auto': '它自动记的',
      'notes.enabledAria': '会带上这条',
      'notes.disabledAria': '已收起这条',
      'notes.toggleHint': '勾选后，它每次工作前会看到这条；取消勾选只是先收起来',
      'notes.disabledNote': '已收起',
      'notes.delete': '移到已删除',
      'notes.edit': '更改',
      'notes.save': '保存',
      'notes.cancel': '取消',
      'notes.undo': '撤回',
      'notes.redo': '重做',
      'notes.undoHint': '撤回上一次更改（还能退 {count} 次）',
      'notes.redoHint': '重做刚才撤回的更改（还能进 {count} 次）',
      'notes.editHint': 'Ctrl+Enter 保存 · Esc 取消',
      'notes.historyCount': '可撤回 {count} 次',
      'notes.loading': '正在读记事本…',
      'sessions.hint': '勾选的对话里，助手会先看记事本；取消勾选就不看。',
      'sessions.empty': '还没有可显示的对话。',
      'sessions.untitled': '还没起名的对话',
      'sessions.enabled': '看记事本',
      'sessions.disabled': '不看记事本',
      'trash.hint': '删掉的记事先放这里，恢复后回到记事本；彻底删除后不可恢复。',
      'trash.empty': '没有删除的记事。',
      'trash.restore': '恢复',
      'trash.purge': '彻底删除',
      'trash.confirmPurge': '彻底删除这条记事？删了就找不回来了。',
      'trash.deletedAt': '删除于',
      'common.refresh': '刷新',
      'common.retry': '重试',
      'footer': '内容只存在本机，不会发到别处；助手每次工作前会先读一遍。',
      'error.prefix': '记事本出错了：',
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || ms <= 0) return ''
      try {
        return new Date(ms).toLocaleString(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return ''
      }
    }

    async function callAction(payload) {
      const response = await fetch(`${API}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const body = await response.json()
      if (!body || body.ok !== true) throw new Error(body?.error?.message || `HTTP ${response.status}`)
      return body.value
    }

    function newerState(previous, next) {
      if (
        previous
        && next
        && typeof previous.revision === 'number'
        && typeof next.revision === 'number'
        && next.revision < previous.revision
      ) {
        return previous
      }
      return next
    }

    function useNotebook() {
      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const busyRef = React.useRef(false)

      const load = React.useCallback(async (silent) => {
        if (silent && busyRef.current) return
        if (!silent) setLoading(true)
        try {
          const response = await fetch(`${API}/state`, { cache: 'no-store', credentials: 'same-origin' })
          const body = await response.json()
          if (!body || body.ok !== true) throw new Error(body?.error?.message || `HTTP ${response.status}`)
          if (silent && busyRef.current) return
          setState((previous) => newerState(previous, body.value))
          setError('')
        } catch (failure) {
          setError(String(failure?.message || failure))
        } finally {
          if (!silent) setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        void load(false)
      }, [load])

      React.useEffect(() => {
        const timer = window.setInterval(() => {
          if (document.visibilityState !== 'hidden') void load(true)
        }, 8000)
        const onFocus = () => { void load(true) }
        window.addEventListener('focus', onFocus)
        return () => {
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [load])

      const act = React.useCallback(async (payload) => {
        busyRef.current = true
        setBusy(`${payload.action}:${payload.id || payload.sessionId || ''}`)
        try {
          const next = await callAction(payload)
          setState((previous) => newerState(previous, next))
          setError('')
          return true
        } catch (failure) {
          setError(String(failure?.message || failure))
          return false
        } finally {
          busyRef.current = false
          setBusy(null)
        }
      }, [])

      return { state, loading, error, busy, act, reload: load }
    }

    function NotebookGlyph({ size = 18 }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      }, [
        h('rect', {
          key: 'book',
          x: 2.75,
          y: 1.75,
          width: 10.5,
          height: 12.5,
          rx: 1.9,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
        }),
        h('path', {
          key: 'spine',
          d: 'M5.35 1.75v12.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          opacity: 0.85,
        }),
        h('path', {
          key: 'lines',
          d: 'M7.7 5.1h3.1M7.7 8h3.1M7.7 10.9h2.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          opacity: 0.75,
        }),
      ])
    }

    function CheckGlyph({ size = 12 }) {
      return h('svg', { viewBox: '0 0 12 12', width: size, height: size, 'aria-hidden': true }, h('path', {
        d: 'M2.2 6.3 4.8 8.9 9.9 3.1',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function TrashGlyph({ size = 15 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true }, [
        h('path', {
          key: 'lid',
          d: 'M3 4.2h10M5.6 4.2V3c0-.4.3-.7.7-.7h3.4c.4 0 .7.3.7.7v1.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'body',
          d: 'M4.5 4.2l.55 8.4c0 .4.35.7.75.7h3.9c.4 0 .75-.3.75-.7l.55-8.4M6.7 6.8v4.2M9.3 6.8v4.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ])
    }

    function PencilGlyph({ size = 15 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true }, [
        h('path', {
          key: 'body',
          d: 'M3 13l.8-3.3 7-7a1.6 1.6 0 0 1 2.3 2.3l-7 7L3 13z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'tip',
          d: 'M9.7 3.6l2.6 2.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
      ])
    }

    function UndoGlyph({ size = 15 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true }, h('path', {
        d: 'M4.2 7h5.4a4 4 0 0 1 0 8H6.3M4.2 7l3-3M4.2 7l3 3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function RedoGlyph({ size = 15 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true }, h('path', {
        d: 'M11.8 7H6.4a4 4 0 0 0 0 8h3.3M11.8 7l-3-3M11.8 7l-3 3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function ChatGlyph({ size = 28 }) {
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true }, h('path', {
        d: 'M4.5 5.5h15v10h-8l-4 3v-3h-3z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinejoin: 'round',
      }))
    }

    function Empty({ text, icon }) {
      return h('div', { className: 'dsh-nb-empty' }, [
        h('span', { key: 'icon', style: { color: 'var(--dsw-alias-label-tertiary)' } }, h(icon, { size: 28 })),
        h('div', { key: 'text', className: 'dsh-nb-empty-title' }, text),
      ])
    }

    function LoadFailed({ t, onRetry }) {
      return h('div', { className: 'dsh-nb-empty' }, [
        h('span', { key: 'icon', style: { color: 'var(--dsw-alias-label-tertiary)' } }, h(NotebookGlyph, { size: 28 })),
        h('div', { key: 'text', className: 'dsh-nb-empty-title' }, t('notes.loadFailed')),
        h('button', {
          key: 'retry',
          type: 'button',
          className: 'dsh-nb-primary',
          onClick: onRetry,
        }, t('common.retry')),
      ])
    }

    function sourceLabel(note, t) {
      if (note.source === 'user') return t('notes.source.user')
      return note.auto === true ? t('notes.source.auto') : t('notes.source.agent')
    }

    function NoteRow({ note, t, act, busy }) {
      const disabled = busy !== null
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState(note.text)
      const historyCount = Array.isArray(note.history) ? note.history.length : 0
      const futureCount = Array.isArray(note.future) ? note.future.length : 0

      const startEdit = () => {
        setDraft(note.text)
        setEditing(true)
      }
      const cancelEdit = () => {
        setDraft(note.text)
        setEditing(false)
      }
      const saveEdit = async () => {
        const text = draft.trim()
        if (!text) return
        if (await act({ action: 'update', id: note.id, text })) setEditing(false)
      }

      const main = editing
        ? h('div', { key: 'main', className: 'dsh-nb-row-main' }, [
          h('textarea', {
            key: 'edit',
            className: 'dsh-nb-textarea dsh-nb-edit',
            rows: 3,
            maxLength: 4000,
            value: draft,
            autoFocus: true,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelEdit()
              } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void saveEdit()
              }
            },
          }),
          h('div', { key: 'hint', className: 'dsh-nb-meta' }, t('notes.editHint')),
        ])
        : h('div', { key: 'main', className: 'dsh-nb-row-main' }, [
          h('div', { key: 'text', className: 'dsh-nb-row-text' }, note.text),
          h('div', { key: 'meta', className: 'dsh-nb-meta' }, [
            h('span', { key: 'tag', className: 'dsh-nb-tag' }, sourceLabel(note, t)),
            formatTime(note.createdAt)
              ? h('span', { key: 'time' }, formatTime(note.createdAt))
              : null,
            historyCount > 0 ? h('span', { key: 'history' }, t('notes.historyCount', { count: historyCount })) : null,
            note.enabled ? null : h('span', { key: 'off' }, t('notes.disabledNote')),
          ]),
        ])

      const actions = editing
        ? h('div', { key: 'actions', className: 'dsh-nb-actionrow' }, [
          h('button', {
            key: 'save',
            type: 'button',
            className: 'dsh-nb-small primary',
            disabled: disabled || !draft.trim(),
            onClick: () => { void saveEdit() },
          }, t('notes.save')),
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dsh-nb-small',
            disabled,
            onClick: cancelEdit,
          }, t('notes.cancel')),
        ])
        : h('div', { key: 'actions', className: 'dsh-nb-actionrow' }, [
          h('button', {
            key: 'edit',
            type: 'button',
            className: 'dsh-nb-small',
            title: t('notes.editHint'),
            disabled,
            onClick: startEdit,
          }, t('notes.edit')),
          historyCount > 0 ? h('button', {
            key: 'undo',
            type: 'button',
            className: 'dsh-nb-small',
            title: t('notes.undoHint', { count: historyCount }),
            disabled,
            onClick: () => { void act({ action: 'undo', id: note.id }) },
          }, t('notes.undo')) : null,
          futureCount > 0 ? h('button', {
            key: 'redo',
            type: 'button',
            className: 'dsh-nb-small',
            title: t('notes.redoHint', { count: futureCount }),
            disabled,
            onClick: () => { void act({ action: 'redo', id: note.id }) },
          }, t('notes.redo')) : null,
          h('button', {
            key: 'delete',
            type: 'button',
            className: 'dsh-nb-icon',
            title: t('notes.delete'),
            'aria-label': t('notes.delete'),
            disabled,
            onClick: () => { void act({ action: 'delete', id: note.id }) },
          }, h(TrashGlyph, {})),
        ])

      return h('div', { className: 'dsh-nb-row', 'data-off': note.enabled ? 'false' : 'true' }, [
        h('button', {
          key: 'check',
          type: 'button',
          className: 'dsh-nb-check',
          role: 'checkbox',
          'aria-checked': note.enabled,
          'aria-label': `${note.enabled ? t('notes.enabledAria') : t('notes.disabledAria')}：${note.text.slice(0, 40)}`,
          title: t('notes.toggleHint'),
          disabled: disabled || editing,
          onClick: () => { void act({ action: 'toggle', id: note.id, enabled: !note.enabled }) },
        }, note.enabled ? h(CheckGlyph, {}) : null),
        main,
        actions,
      ])
    }

    function NotesTab({ t, notes, draft, setDraft, submit, act, busy }) {
      const enabledCount = notes.filter((note) => note.enabled).length
      return h('div', { className: 'dsh-nb-stack' }, [
        h('div', { key: 'compose', className: 'dsh-nb-compose' }, [
          h('textarea', {
            key: 'input',
            className: 'dsh-nb-textarea',
            rows: 3,
            maxLength: 4000,
            value: draft,
            placeholder: t('notes.placeholder'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void submit()
              }
            },
          }),
          h('div', { key: 'row', className: 'dsh-nb-compose-row' }, [
            h('span', { key: 'hint', className: 'dsh-nb-hint' }, t('notes.composeHint')),
            h('button', {
              key: 'add',
              type: 'button',
              className: 'dsh-nb-primary',
              disabled: !draft.trim() || busy !== null,
              onClick: () => { void submit() },
            }, t('notes.add')),
          ]),
        ]),
        h('div', { key: 'stat', className: 'dsh-nb-stat' }, t('notes.count', { count: notes.length, enabled: enabledCount })),
        notes.length === 0
          ? h(Empty, { key: 'empty', text: t('notes.empty'), icon: NotebookGlyph })
          : h('div', { key: 'list', className: 'dsh-nb-stack' }, notes.map((note) => h(NoteRow, {
            key: note.id,
            note,
            t,
            act,
            busy,
          }))),
      ])
    }

    function ConversationRow({ conversation, t, act, busy }) {
      const disabled = busy !== null
      const title = conversation.title || t('sessions.untitled')
      return h('div', { className: 'dsh-nb-row' }, [
        h('button', {
          key: 'check',
          type: 'button',
          className: 'dsh-nb-check',
          role: 'checkbox',
          'aria-checked': conversation.enabled,
          'aria-label': `${conversation.enabled ? t('sessions.enabled') : t('sessions.disabled')}：${title}`,
          disabled,
          onClick: () => {
            void act({ action: 'session', sessionId: conversation.id, enabled: !conversation.enabled })
          },
        }, conversation.enabled ? h(CheckGlyph, {}) : null),
        h('div', { key: 'main', className: 'dsh-nb-row-main' }, [
          h('div', { key: 'title', className: 'dsh-nb-row-text' }, title),
          h('div', { key: 'meta', className: 'dsh-nb-meta' }, [
            h('span', { key: 'state', className: 'dsh-nb-tag' }, conversation.enabled ? t('sessions.enabled') : t('sessions.disabled')),
            conversation.cwd ? h('span', { key: 'cwd', className: 'dsh-nb-cwd' }, conversation.cwd) : null,
            formatTime(conversation.createdAt) ? h('span', { key: 'time' }, formatTime(conversation.createdAt)) : null,
          ]),
        ]),
      ])
    }

    function SessionsTab({ t, conversations, act, busy }) {
      if (conversations.length === 0) return h(Empty, { text: t('sessions.empty'), icon: ChatGlyph })
      return h('div', { className: 'dsh-nb-stack' }, [
        h('div', { key: 'hint', className: 'dsh-nb-sessions-hint' }, t('sessions.hint')),
        ...conversations.map((conversation) => h(ConversationRow, {
          key: conversation.id,
          conversation,
          t,
          act,
          busy,
        })),
      ])
    }

    function TrashTab({ t, trash, act, busy }) {
      if (trash.length === 0) return h(Empty, { text: t('trash.empty'), icon: TrashGlyph })
      const disabled = busy !== null
      return h('div', { className: 'dsh-nb-stack' }, [
        h('div', { key: 'hint', className: 'dsh-nb-sessions-hint' }, t('trash.hint')),
        ...trash.map((note) => h('div', { key: note.id, className: 'dsh-nb-row' }, [
          h('div', { key: 'main', className: 'dsh-nb-row-main' }, [
            h('div', { key: 'text', className: 'dsh-nb-row-text' }, note.text),
            h('div', { key: 'meta', className: 'dsh-nb-meta' }, [
              h('span', { key: 'tag', className: 'dsh-nb-tag' }, sourceLabel(note, t)),
              h('span', { key: 'time' }, `${t('trash.deletedAt')} ${formatTime(note.deletedAt)}`),
            ]),
          ]),
          h('div', { key: 'actions', className: 'dsh-nb-actionrow' }, [
            h('button', {
              key: 'restore',
              type: 'button',
              className: 'dsh-nb-small',
              disabled,
              onClick: () => { void act({ action: 'restore', id: note.id }) },
            }, t('trash.restore')),
            h('button', {
              key: 'purge',
              type: 'button',
              className: 'dsh-nb-small danger',
              disabled,
              onClick: () => {
                if (window.confirm(t('trash.confirmPurge'))) void act({ action: 'purge', id: note.id })
              },
            }, t('trash.purge')),
          ]),
        ])),
      ])
    }

    const CSS = `
      .dsh-nb-page{display:flex;flex-direction:column;height:100%;box-sizing:border-box;min-width:0;padding:20px 24px 12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden}
      .dsh-nb-head{display:flex;align-items:flex-start;gap:16px;padding-bottom:4px}
      .dsh-nb-head-main{flex:1 1 auto;min-width:0}
      .dsh-nb-title{font-size:16px;line-height:24px;font-weight:600;letter-spacing:.01em}
      .dsh-nb-sub{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);max-width:680px}
      .dsh-nb-refresh{flex:none;appearance:none;border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border-radius:7px;cursor:pointer}
      .dsh-nb-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dsh-nb-tabs{display:flex;gap:2px;border-bottom:0.5px solid var(--dsw-alias-border-l1);margin:12px 0 0}
      .dsh-nb-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;padding:7px 10px;border-radius:6px 6px 0 0;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:6px}
      .dsh-nb-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dsh-nb-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);font-weight:600}
      .dsh-nb-tab[aria-selected="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-0.5px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary)}
      .dsh-nb-count{min-width:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;text-align:center;font-weight:500}
      .dsh-nb-body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 2px 8px;box-sizing:border-box}
      .dsh-nb-stack{display:flex;flex-direction:column;gap:8px}
      .dsh-nb-compose{border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:10px 12px 8px;display:flex;flex-direction:column;gap:8px;box-shadow:var(--dsw-elevation-soft)}
      .dsh-nb-textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:58px;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:0}
      .dsh-nb-edit{min-height:52px;padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
      .dsh-nb-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
      .dsh-nb-compose-row{display:flex;align-items:center;gap:12px;justify-content:space-between}
      .dsh-nb-hint{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);min-width:0}
      .dsh-nb-primary{appearance:none;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);font:inherit;font-size:12.5px;font-weight:600;line-height:18px;padding:6px 14px;cursor:pointer;flex:none}
      .dsh-nb-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
      .dsh-nb-primary:disabled{opacity:.45;cursor:default}
      .dsh-nb-stat{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);padding:0 2px}
      .dsh-nb-row{display:flex;align-items:flex-start;gap:10px;border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:10px 12px;transition:background .12s ease,border-color .12s ease}
      .dsh-nb-row:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
      .dsh-nb-row[data-off="true"]{opacity:.58}
      .dsh-nb-check{flex:none;margin:1px 0 0;width:18px;height:18px;padding:0;border-radius:5px;border:1.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary-inverted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
      .dsh-nb-check[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .dsh-nb-check:disabled{cursor:default;opacity:.6}
      .dsh-nb-check:focus-visible,.dsh-nb-tab:focus-visible,.dsh-nb-primary:focus-visible,.dsh-nb-refresh:focus-visible,.dsh-nb-icon:focus-visible,.dsh-nb-small:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
      .dsh-nb-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
      .dsh-nb-row-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:20px}
      .dsh-nb-row[data-off="true"] .dsh-nb-row-text{text-decoration:line-through;text-decoration-color:var(--dsw-alias-label-tertiary);text-decoration-thickness:1px}
      .dsh-nb-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .dsh-nb-cwd{min-width:0;max-width:100%;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-nb-tag{display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
      .dsh-nb-icon{flex:none;appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
      .dsh-nb-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
      .dsh-nb-icon:disabled{opacity:.5;cursor:default}
      .dsh-nb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:48px 20px;color:var(--dsw-alias-label-tertiary);text-align:center}
      .dsh-nb-empty-title{font-size:13px;color:var(--dsw-alias-label-secondary);max-width:400px}
      .dsh-nb-banner{display:flex;align-items:flex-start;gap:10px;border:0.5px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:9px 12px;margin-top:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
      .dsh-nb-banner-main{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
      .dsh-nb-link{appearance:none;border:none;background:transparent;color:var(--dsw-alias-link);font:inherit;cursor:pointer;padding:0;flex:none}
      .dsh-nb-foot{flex:none;padding:8px 2px 0;border-top:0.5px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .dsh-nb-sessions-hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);padding:0 2px 2px}
      .dsh-nb-actionrow{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}
      .dsh-nb-small{appearance:none;border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:16px;padding:3px 8px;border-radius:6px;cursor:pointer;flex:none}
      .dsh-nb-small.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);font-weight:600}
      .dsh-nb-small.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted)}
      .dsh-nb-small:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dsh-nb-small.danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
      .dsh-nb-small:disabled{opacity:.5;cursor:default}
      .dsh-nb-loading{padding:40px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
    `

    function Panel({ t }) {
      const notebook = useNotebook()
      const [tab, setTab] = React.useState('notes')
      const [draft, setDraft] = React.useState('')
      const submittingRef = React.useRef(false)
      const state = notebook.state
      const notes = state ? state.notes : []
      const trash = state ? state.trash : []
      const conversations = state ? state.conversations : []

      const submit = React.useCallback(async () => {
        const text = draft.trim()
        if (!text || notebook.busy !== null || submittingRef.current) return
        submittingRef.current = true
        try {
          if (await notebook.act({ action: 'add', text })) setDraft('')
        } finally {
          submittingRef.current = false
        }
      }, [draft, notebook.act, notebook.busy])

      const tabs = [
        { id: 'notes', label: t('tabs.notes'), count: notes.length },
        { id: 'sessions', label: t('tabs.sessions'), count: conversations.length },
        { id: 'trash', label: t('tabs.trash'), count: trash.length },
      ]

      let body
      if (state === null && notebook.loading) {
        body = h('div', { className: 'dsh-nb-loading' }, t('notes.loading'))
      } else if (state === null) {
        body = h(LoadFailed, { t, onRetry: () => { void notebook.reload(false) } })
      } else if (tab === 'sessions') {
        body = h(SessionsTab, { t, conversations, act: notebook.act, busy: notebook.busy })
      } else if (tab === 'trash') {
        body = h(TrashTab, { t, trash, act: notebook.act, busy: notebook.busy })
      } else {
        body = h(NotesTab, {
          t,
          notes,
          draft,
          setDraft,
          submit,
          act: notebook.act,
          busy: notebook.busy,
        })
      }

      return h('div', { className: 'dsh-nb-page' }, [
        h('style', { key: 'style' }, CSS),
        h('div', { key: 'head', className: 'dsh-nb-head' }, [
          h('div', { key: 'main', className: 'dsh-nb-head-main' }, [
            h('div', { key: 'title', className: 'dsh-nb-title' }, t('panel.title')),
            h('div', { key: 'sub', className: 'dsh-nb-sub' }, t('panel.subtitle')),
          ]),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsh-nb-refresh',
            title: t('common.refresh'),
            onClick: () => { void notebook.reload(false) },
          }, t('common.refresh')),
        ]),
        h('div', { key: 'tabs', className: 'dsh-nb-tabs', role: 'tablist' }, tabs.map((entry) => h('button', {
          key: entry.id,
          type: 'button',
          role: 'tab',
          id: `dsh-nb-tab-${entry.id}`,
          'aria-controls': 'dsh-nb-panel',
          className: 'dsh-nb-tab',
          'aria-selected': tab === entry.id,
          onClick: () => setTab(entry.id),
        }, [
          h('span', { key: 'label' }, entry.label),
          h('span', { key: 'count', className: 'dsh-nb-count' }, entry.count),
        ]))),
        notebook.error && state !== null
          ? h('div', { key: 'error', className: 'dsh-nb-banner', role: 'alert' }, [
            h('span', { key: 'text', className: 'dsh-nb-banner-main' }, `${t('error.prefix')}${notebook.error}`),
            h('button', {
              key: 'retry',
              type: 'button',
              className: 'dsh-nb-link',
              onClick: () => { void notebook.reload(false) },
            }, t('common.retry')),
          ])
          : null,
        h('div', {
          key: 'body',
          id: 'dsh-nb-panel',
          className: 'dsh-nb-body',
          role: 'tabpanel',
          'aria-labelledby': `dsh-nb-tab-${tab}`,
        }, body),
        h('div', { key: 'foot', className: 'dsh-nb-foot' }, t('footer')),
      ])
    }

    function PanelView({ locale }) {
      // 槽位通过 inject 传 locale；闭包兜底，避免注册选项差异导致整块空白。
      const activeLocale = locale || localeService
      const subscribe = React.useCallback((callback) => activeLocale.subscribe(callback), [activeLocale])
      const snapshot = React.useCallback(() => activeLocale.getSnapshot(), [activeLocale])
      React.useSyncExternalStore(subscribe, snapshot)
      return h(Panel, { t: activeLocale.bind(NS) })
    }

    function apply(ctx) {
      const locale = ctx.locale
      localeService = locale
      const t = locale.bind(NS)
      ctx.effect(() => locale.register(NS, 'en', DICT_EN), 'dsh-notebook locale en')
      ctx.effect(() => locale.register(NS, 'zh', DICT_ZH), 'dsh-notebook locale zh')
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 40,
        label: () => t('panel.title'),
      }, NotebookGlyph))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ locale }),
      }, PanelView))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
