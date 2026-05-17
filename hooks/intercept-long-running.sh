#!/bin/sh
# Placeholder hook — referenced by ~/.claude/settings.json as a PreToolUse:Bash
# hook. The original intent was dashboard-side instrumentation for long-running
# bash commands; that flow isn't built yet, so this is a no-op so Claude Code
# stops printing "no such file" errors on every Bash invocation.
#
# To remove the noise entirely, delete the corresponding entry from
# ~/.claude/settings.json. To add real behavior, replace this file's body.
exit 0
