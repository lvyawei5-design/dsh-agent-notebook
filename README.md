# dsh-agent-notebook

A local notebook for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with a left-sidebar entry.

The assistant records what it did in plain language, you can write long-term instructions (for example which software may be used freely), and checked notes are injected into the system prompt before every task. Each note has a checkbox; each conversation can be switched on or off; deletions go to a trash list that can be restored.

## 中文简介

左侧栏里的「记事本」：

- **它做过的事会自己记**：一个回合里只要真的动过工具，回合结束就把收尾总结用大白话记一条；如果它收尾时已经主动记过，就不重复。
- **你也能往里面记**：写下长期要求，比如「这个软件可以随便用」。
- **每条都能勾选/取消**：勾选的内容会在它每次工作前先读一遍；取消只是先收起来。
- **按对话开关**：「对话」页可以给每个对话整体关掉记事本；关掉后工具也会拒绝读写。
- **删掉的能找回**：先进「已删除」，可恢复，也可彻底删除。

内容只存在本机：`<profile>/data/notebook/notebook.json`，不会发到别处。

## Install

Once this package is published to npm:

```sh
dsh plugin --profile web add dsh-agent-notebook
```

From a GitHub Release tarball:

```sh
dsh plugin --profile web add https://github.com/lvyawei5-design/dsh-agent-notebook/releases/latest/download/dsh-agent-notebook.tgz
```

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

- Automatic records keep the newest 120 entries; notes you write yourself are never auto-pruned.
- The prompt shows up to 40 user notes and 10 recent assistant notes, within an 8,000-character budget. Extra notes are summarized as “还有 N 条没有展开”.
- The Conversations page lists the newest 40 top-level sessions; switches for older sessions are still stored.
- Disabling a conversation stops prompt injection, tool reads/writes, and automatic recording for that conversation.

## License

MIT
