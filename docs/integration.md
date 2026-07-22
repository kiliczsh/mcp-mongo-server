# Integration

## Claude Desktop

Add the server configuration to Claude Desktop's config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

- [Command-line args example](../examples/claude-desktop.jsonc)
- [Environment variables example](../examples/claude-desktop-env.jsonc)
- [GitHub package example](../examples/github-package.jsonc)

## Windsurf

- [Windsurf example](../examples/windsurf.jsonc)

## Cursor

- [Cursor example](../examples/cursor.jsonc)

You can also use the environment variables approach with both Windsurf and Cursor, following the same pattern shown in the Claude Desktop configuration.

## Remote access (HTTP)

The examples above run the server locally over stdio. To reach it over the
network instead — for a remote client or several clients at once — start it in
HTTP mode:

```bash
npx -y mcp-mongo-server "mongodb://user:pass@localhost:27017/mydatabase" \
  --transport http --port 3001
```

The server then listens for MCP requests at `http://<host>:3001/mcp`.

For safety, browser requests are only accepted from `localhost` by default;
any other browser `Origin` is rejected with `403` (DNS-rebinding protection).
Non-browser clients (which send no `Origin` header) are always allowed. To let
a specific web origin connect, list it explicitly:

```bash
npx -y mcp-mongo-server "mongodb://..." --transport http --port 3001 \
  --allowed-origins "https://app.example.com"
```

The same value can be set with the `MCP_HTTP_ALLOWED_ORIGINS` environment
variable (comma-separated for multiple origins).

HTTP request bodies are limited to `10mb` by default (matching the stdio
transport). Raise or lower it with `--json-limit` (for example
`--json-limit 50mb`) or the `MCP_HTTP_JSON_LIMIT` environment variable.

## Docker

- [docker-compose example](../examples/docker-compose.yml)

```bash
# Build
docker build -t mcp-mongo-server .

# Run
docker run -it -d -e MCP_MONGODB_URI="mongodb://username:password@localhost:27017/database" -e MCP_MONGODB_READONLY="true" mcp-mongo-server

# or use docker-compose
docker-compose up -d
```

## MCP Inspector

- [Inspector config example](../examples/inspector-config.jsonc)

## Automated Installation

**Using Smithery**:
```bash
npx -y @smithery/cli install mcp-mongo-server --client claude
```

**Using mcp-get**:
```bash
npx @michaellatman/mcp-get@latest install mcp-mongo-server
```
