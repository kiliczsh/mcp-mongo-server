# MCP MongoDB Server
---
![NPM Version](https://img.shields.io/npm/v/mcp-mongo-server)
![NPM Downloads](https://img.shields.io/npm/dm/mcp-mongo-server)
![NPM License](https://img.shields.io/npm/l/mcp-mongo-server)
[![smithery badge](https://smithery.ai/badge/mcp-mongo-server)](https://smithery.ai/server/mcp-mongo-server)

A Model Context Protocol server that provides access to MongoDB databases. This server enables LLMs to inspect collection schemas and execute MongoDB operations.

## Demo

[![MCP MongoDB Server Demo | Claude Desktop](https://img.youtube.com/vi/FI-oE_voCpA/0.jpg)](https://www.youtube.com/watch?v=FI-oE_voCpA)

## Features

### Read-Only Mode
- Connect to MongoDB in read-only mode with `--read-only` or `-r` flag
- Prevents write operations (update, insert, createIndex)
- Uses MongoDB's secondary read preference for optimal read performance
- Provides additional safety for production database connections

### Resources
- List and access collections via `mongodb://` URIs
- Each collection has a name, description and schema
- JSON mime type for schema access

### Tools
- **query**
  - Execute MongoDB queries with optional execution plan analysis
  - Input: Collection name, filter, projection, limit, explain options
  - Returns query results or execution plan

- **aggregate**
  - Execute MongoDB aggregation pipelines with optional execution plan analysis
  - Input: Collection name, pipeline stages, explain options
  - Returns aggregation results or execution plan

- **update**
  - Update documents in a collection
  - Input: Collection name, filter, update operations, upsert/multi options
  - Returns update operation results

- **serverInfo**
  - Get MongoDB server information and status
  - Input: Optional debug info flag
  - Returns version, storage engine, and server details

- **insert**
  - Insert documents into a collection
  - Input: Collection name, documents array, write options
  - Returns insert operation results

- **createIndex**
  - Create indexes on a collection
  - Input: Collection name, index specifications, write options
  - Returns index creation results

- **count**
  - Count documents matching a query
  - Input: Collection name, query filter, count options
  - Returns document count

### Prompts
- `analyze_collection` - Analyze collection structure and contents
  - Input: Collection name
  - Output: Insights about schema, data types, and statistics


## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation for Development

### Using Claude Desktop

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "node",
      "args": [
        "~/mcp-mongo-server/build/index.js",
        "mongodb://muhammed:kilic@mongodb.localhost/namespace"
      ]
    },
    "mongodb-readonly": {
      "command": "node",
      "args": [
        "~/mcp-mongo-server/build/index.js",
        "mongodb://muhammed:kilic@mongodb.localhost/namespace",
        "--read-only"
      ]
    }
  }
}
```


### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Components


### Resources

The server provides schema information for each collection in the database:

- **Collection Schemas** (`mongodb://<host>/<collection>/schema`)
  - JSON schema information for each collection
  - Includes field names and data types
  - Automatically inferred from collection documents


## Usage with Claude Desktop

To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server",
        "mongodb://muhammed:kilic@mongodb.localhost/sample_namespace"
      ]
    },
    "mongodb-readonly": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-mongo-server",
        "mongodb://muhammed:kilic@mongodb.localhost/sample_namespace",
        "--read-only"
      ]
    }
  }
}
```

### Installing via Smithery

To install MCP MongoDB Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/mcp-mongo-server):

```bash
npx -y @smithery/cli install mcp-mongo-server --client claude
```

### Installing via mcp-get

You can install this package using mcp-get:

```bash
npx @michaellatman/mcp-get@latest install mcp-mongo-server
```

Replace `/sample_namespace` with your database name.

## Using Read-Only Mode

You can connect to MongoDB in read-only mode by adding the `--read-only` or `-r` flag when starting the server. This is recommended when you need to protect your data from accidental writes or when connecting to production databases.

```bash
# Connect in read-only mode using the command line
npx mcp-mongo-server mongodb://user:password@mongodb.example.com/database --read-only
```

When in read-only mode:
1. All write operations (update, insert, createIndex) will be blocked
2. The server connects using MongoDB's secondary read preference
3. The connection status indicates read-only mode is active
4. The `ping` and `serverInfo` responses include read-only status information

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
