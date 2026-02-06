# Integration

## Claude Desktop

Add the server configuration to Claude Desktop's config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

### Command-line Arguments Approach:

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server",
        "mongodb://muhammed:kilic@localhost:27017/database"
      ]
    },
    "mongodb-readonly": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server",
        "mongodb://muhammed:kilic@localhost:27017/database",
        "--read-only"
      ]
    }
  }
}
```

### Environment Variables Approach:

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server"
      ],
      "env": {
        "MCP_MONGODB_URI": "mongodb://muhammed:kilic@localhost:27017/database"
      }
    },
    "mongodb-readonly": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server"
      ],
      "env": {
        "MCP_MONGODB_URI": "mongodb://muhammed:kilic@localhost:27017/database",
        "MCP_MONGODB_READONLY": "true"
      }
    }
  }
}
```

### GitHub Package Usage:

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": [
        "-y",
        "github:kiliczsh/mcp-mongo-server",
        "mongodb://muhammed:kilic@localhost:27017/database"
      ]
    }
  }
}
```

## Windsurf

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server",
        "mongodb://muhammed:kilic@localhost:27017/database"
      ]
    }
  }
}
```

## Cursor

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server",
        "mongodb://muhammed:kilic@localhost:27017/database"
      ]
    }
  }
}
```

You can also use the environment variables approach with both Windsurf and Cursor, following the same pattern shown in the Claude Desktop configuration.

## Automated Installation

**Using Smithery**:
```bash
npx -y @smithery/cli install mcp-mongo-server --client claude
```

**Using mcp-get**:
```bash
npx @michaellatman/mcp-get@latest install mcp-mongo-server
```

## Docker

```bash
# Build
docker build -t mcp-mongo-server .

# Run
docker run -it -d -e MCP_MONGODB_URI="mongodb://muhammed:kilic@localhost:27017/database" -e MCP_MONGODB_READONLY="true" mcp-mongo-server

# or edit docker-compose.yml and run
docker-compose up -d
```
