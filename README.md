# dsh-agent-notebook

A local notebook for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with a left-sidebar entry.

The assistant decides what is worth keeping — key decisions, your preferences, important results, and the files, plugins, or addresses it produced — and leaves process details out. You can write long-term instructions (for example which software may be used freely); notes you write are pinned by default. Checked notes are injected into the system prompt before every task. Notes can be pinned, edited with undo/redo, and each conversation can be switched on or off; deletions go to a trash list that can be restored. Stale automatic records are cleaned after 30 days, and the agent can clean temporary or build files from work directories.

## 中文简介

左侧栏里的「记事本」：

- **它只记重要的**：助手自己判断什么值得记——关键决定、你的偏好、重要结果、文件/插件/地址；过程细节不记，普通聊天、只查东西、只跑命令看结果都不记。
- **你也能往里面记，默认置顶**：写下长期要求，比如「这个软件可以随便用」；你写的新记事默认置顶，可以点图钉取消。
- **改错能撤回**：每条记事都有「更改」；改完可以「保存」，不满意点「撤回」，连续点会一步步退回，撤过头还能「重做」。最多保留 20 步。
- **每条都能勾选/取消**：勾选的内容会在它每次工作前先读一遍；取消只是先收起来。
- **按对话开关**：「对话」页可以给每个对话整体关掉记事本；关掉后工具也会拒绝读写。
- **删掉的能找回**：先进「已删除」，可恢复，也可彻底删除。
- **会自己清**：超过 30 天的自动记录会自动清掉（手写和置顶的永不自动删）；工作结束也会清理临时文件、缓存和构建产物，只清这些，不动源码和交付物。

内容只存在本机：`<profile>/data/notebook/notebook.json`，不会发到别处。

## Install

Once this package is published to npm:

```sh
dsh plugin --profile web add dsh-agent-notebook
```

Once listed in the plugin market, install it from the market entry; the entry uses the version-free release tarball.

From a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-agent-notebook
```

After installation, refresh the Web page once if the sidebar entry is not visible yet.

## Usage

1. Open **记事本 / Notebook** in the left sidebar.
2. On the **记事 / Notes** page, write a note and press `Ctrl+Enter` (or the button). Use the checkbox to include or hide it.
3. On the **对话 / Conversations** page, choose which conversations use the notebook.
4. On the **已删除 / Deleted** page, restore or permanently delete entries.

The agent also has a `notebook` tool with `list`, `add`, `update`, `toggle`, `delete`, `restore`, `purge`, and `session` actions.

## Limits

- Automatic records older than 30 days or beyond the newest 120 are pruned; notes you write and pinned notes are never auto-pruned.
- Work-directory cleanup removes only known temporary/cache names, and build directories only when explicitly requested. It never removes source, deliverables, `.git`, or `node_modules`.
- The prompt shows up to 40 user notes and 10 recent assistant notes, within an 8,000-character budget. Extra notes are summarized as “还有 N 条没有展开”.
- The Conversations page lists the newest 40 top-level sessions; switches for older sessions are still stored.
- Disabling a conversation stops prompt injection, tool reads/writes, and automatic recording for that conversation.

## License

MIT
