#!/bin/zsh
set -eu
url="$1"
out="$2"
settle="${3:-4}"
agent-browser open "$url" >/dev/null
agent-browser wait --fn "document.body.innerText.includes(\"dependencies drawn\")" >/dev/null
sleep "$settle"
agent-browser screenshot "$out"
