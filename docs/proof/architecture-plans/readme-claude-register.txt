$ HOME=/var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/tmp.EebdElWNlv claude mcp add --scope user --transport http uml-pr-review http://127.0.0.1:4477/mcp
Added HTTP MCP server uml-pr-review with URL: http://127.0.0.1:4477/mcp to user config
File modified: /var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/tmp.EebdElWNlv/.claude.json
$ HOME=/var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/tmp.EebdElWNlv claude mcp list
Checking MCP server health…

uml-pr-review: http://127.0.0.1:4477/mcp (HTTP) - ✔ Connected
$ grep -A4 '"uml-pr-review"' /var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/tmp.EebdElWNlv/.claude.json
    "uml-pr-review": {
      "type": "http",
      "url": "http://127.0.0.1:4477/mcp"
    }
  }
