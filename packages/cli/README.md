# @agent/cli

The `agent` daemon. It connects a computer to your workspace and runs the workspace's agents on
[Claude Code](https://docs.claude.com/en/docs/claude-code) through the Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk`, pinned to 0.3.301).

## Setup

1. Give the machine a Claude identity, either:
   - run `claude` once and sign in (the daemon uses that login), or
   - set `ANTHROPIC_API_KEY` in the environment that starts the daemon.

   The daemon runs with that machine's Claude login or `ANTHROPIC_API_KEY`. For distribution
   outside your team, use API keys: per Anthropic's policy a personal Claude login must not be
   shared or offered to other people.

2. In the web app (Computers), generate a pairing code, then from the repo root:

   ```bash
   pnpm --filter @agent/cli build
   pnpm agent connect --server http://localhost:3000 --code ABCD-EFGH [--name "My Mac"] [--start]
   pnpm agent start
   ```

## Commands

| Command                                      | What it does                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent connect --server <url> --code <code>` | Pairs, writes `~/.agent/config.json` (mode 0600). `--start` runs the daemon right after.                                                                                                                           |
| `agent start`                                | Heartbeat every 5 s, claims work every 2 s, runs it; while a run is active its lease is renewed every 2 s so a server-side cancel stops it within about 2 s. SIGINT/SIGTERM abort runs, then log `daemon stopped`. |
| `agent status`                               | Shows the config, checks the gateway is reachable and hints about the Claude login.                                                                                                                                |
| `agent disconnect`                           | Deletes the local config. Remove the computer in the web app to revoke its key.                                                                                                                                    |

Capacity: one task run per agent, up to `maxChats` (default 3) concurrent chat replies.

## Config

`~/.agent/config.json` (override the directory with `AGENT_HOME`):

```json
{
  "server": "http://localhost:3000",
  "apiKey": "agk_...",
  "computerId": "...",
  "workspace": { "id": "...", "name": "...", "slug": "..." },
  "extraAllowedTools": ["Bash(git status *)", "Bash(pnpm test *)"],
  "allowWebFetch": false,
  "workdirRoots": ["~/.agent/agents"],
  "maxChats": 3
}
```

## What an agent may do

Each run uses `permissionMode: 'dontAsk'`: anything not pre-approved is denied, nothing prompts.
`settingSources: []` ignores project and user Claude settings and hooks.

Bare `Read`/`Edit`/`Write` rules are **not** confined to the working directory, so the daemon
never uses them. For a workdir `/home/me/.agent/agents/hana` it passes path-scoped rules
(`//` means an absolute path in Claude Code's rule syntax):

- Allowed: `Read(//home/me/.agent/agents/hana/**)`, `Edit(...)`, `Write(...)` with the same path,
  and the `workspace` tools (`mcp__workspace__*`).
- Grep and Glob: the SDK documents no path-scoped rule for them, so the daemon neither allows nor
  denies them by name. They stay on Claude Code's default policy under `dontAsk`: the working
  directory is the only place they search by default, and Claude Code applies the Read deny rules
  below to them on a best-effort basis. Treat them as confined to the workdir, not as sandboxed.
- Edit and Write are additionally denied inside the workdir for `.git/**`, `.claude/**`,
  `.envrc`, `.vscode/**`, `.idea/**`, `.husky/**` and `.mcp.json`, at the top level and in nested
  directories (`**/.git/**`, `**/.claude/**`, ...), so an agent cannot plant git hooks or
  auto-run config. (`package.json` scripts are out of scope.)
- Denied for Read, Edit and Write, even if a workdir root covers them (deny wins over allow):
  `~/.ssh/**`, `~/.claude/**`, `~/.claude.json`, `~/.aws/**`, `~/.gnupg/**`, `~/.netrc`, `~/.npmrc`,
  `~/.agent/config.json` (the API key), and the shell rc files `~/.zshrc`, `~/.zshenv`,
  `~/.zprofile`, `~/.zlogin`, `~/.bashrc`, `~/.bash_profile`, `~/.bash_login`, `~/.profile`,
  `~/.config/fish/**`.
- Everything else is denied until you add it to `extraAllowedTools`. To allow shell commands, add
  Claude Code permission rules, for example `"Bash(git status *)"` or `"Bash(pnpm test *)"`. Be
  specific: a broad rule like `"Bash"` lets the agent run anything as your user, and a Bash rule
  is not confined to the workdir at all.
- `WebFetch` is denied unless `allowWebFetch` is true.
- The `workspace` tools call `POST /gateway/tools/:name` with the assignment id. The server runs
  them with the permissions of the member who made the request, so an agent cannot do more than
  that member. Admin-only tools (`create_agent`, `update_agent`) are only offered when the
  requester is an owner or admin, and never in task runs. In task runs the server also refuses
  `move_task` to `done` and changing `requiresReview`: review stays a human decision.

### Skills

The workspace skill library reaches agents through `skillDefs` in the assignment (enabled skills
of that agent; a server that does not send it means no skills). Before each run the daemon syncs
a Claude Code plugin named `workspace` as an immutable snapshot per skill set,
`~/.agent/skills/<agentId>/<hash>/` (the hash covers the sorted skills and their rendered text),
outside the workdir: `.claude-plugin/plugin.json` and `skills/<slug>/SKILL.md` (frontmatter `name`
and `description`, then the skill content), and nothing else. A snapshot that already matches is
reused; one that differs (or has extra entries such as hooks or commands) is rebuilt. Files are
written atomically and symlinks are never followed. Runs of one agent with different skill sets
use different snapshots; the daemon counts the runs using each snapshot and, on the next sync,
removes the agent's other snapshots (and any stray entry) unless a run still uses them. A slug
outside `^[a-z0-9-]{1,64}$` fails the run. The query gets
`plugins: [{ type: 'local', path, skipMcpDiscovery: true }]` and
`skills: ['workspace:<slug>', ...]` (neither when there are no skills); `settingSources` stays
`[]`. Skill text is member-authored, so every run sets `settings: { disableSkillShellExecution: true }`
(inline `!` commands and fenced shell blocks in skills are never executed), and the daemon also
rewrites those constructs to plain text when it writes SKILL.md; runs of a dash in a description
are escaped so they cannot end the frontmatter. Agents cannot Edit or Write under `~/.agent/skills/**`.

### Working directory

The server chooses each agent's `workdir`, so the daemon validates it first. It is expanded
(`~`), resolved, rejected if empty, and must be strictly inside one of `workdirRoots`
(default `["~/.agent/agents"]`, created if missing). The check runs on the resolved path before
anything is created and again on the `realpath` afterwards, so `/`, `~`, `../..` and symlinks
that leave a root all fail the run with `workdir outside allowed roots: ...`, reported to the
server as a failed result. To let agents work in your projects, add the parent folder to
`workdirRoots` in `config.json`.

### Shared workdir

An agent has one workdir, `~/.agent/agents/<slug>-<id6>` by default (a short id suffix keeps two
agents with the same name apart). It is shared by every member's DM with that agent and by its
task runs, so a file written in one DM is visible to the agent in another. Do not treat the
workdir as private per member.

### Recovery and reporting

- If a resumed session is unknown on this machine ("No conversation found"), the run is retried
  once with a fresh session id, which is reported in the result.
- Progress events are retried with backoff on 408/429/5xx/network errors and dropped on other 4xx.
- While the server is unreachable, heartbeat and claim back off exponentially (cap 60 s).
- Results are trimmed to 900 KB of UTF-8 (`…(đã cắt)` appended) and progress batches are split to stay under 900 KB per request. If the server answers 413/400 to a result, it is retried once with the text cut to 50 KB.
- Cancel: the assignment heartbeat (every 2 s while running) and the computer heartbeat (`cancelled: [ids]`) both abort the run; the daemon logs `aborted <id> (cancelled by server)`.
- On shutdown, runs are aborted and reported `failed: daemon stopped`. An assignment claimed
  while shutting down is accepted and reported the same way instead of being left to its lease.
- Tool inputs in events are capped at 200 characters; file bodies (`content`, `old_string`,
  `new_string`) are shown as `<N chars>`.

## Security notes

- The API key in `config.json` lets anyone act as this computer; keep the file private. Use an
  `https://` server: `connect` warns when given plain `http://` to a non-local host.
- Rules are not a sandbox: a symlink inside the workdir is resolved by Claude Code before the
  path rules apply, and any Bash rule you add runs with your user's rights.
- Run the daemon on machines you trust; agents execute with your Claude login or API key.

## Development

```bash
pnpm --filter @agent/cli test        # vitest, fetch and the Agent SDK are mocked
pnpm --filter @agent/cli build       # tsup -> dist/main.js
```
