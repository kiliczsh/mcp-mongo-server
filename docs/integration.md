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
