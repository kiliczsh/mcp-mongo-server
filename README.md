# MCP MongoDB Server
---
![NPM Version](https://img.shields.io/npm/v/mcp-mongo-server)
![NPM Downloads](https://img.shields.io/npm/dm/mcp-mongo-server)
![NPM License](https://img.shields.io/npm/l/mcp-mongo-server)
[![smithery badge](https://smithery.ai/badge/mcp-mongo-server)](https://smithery.ai/protocol/mcp-mongo-server)

A Model Context Protocol server that provides access to MongoDB databases. This server enables LLMs to inspect collection schemas and execute read-only queries.

## Demo

[![MCP MongoDB Server Demo | Claude Desktop](https://img.youtube.com/vi/FI-oE_voCpA/0.jpg)](https://www.youtube.com/watch?v=FI-oE_voCpA)

## Features

### Resources
- List and access collections via `mongodb://` URIs
- Each collection has a name, description and schema
- JSON mime type for schema access

### Tools
- **query**
  - Execute read-only MongoDB queries against the connected database
  - Input: `query` (object): The MongoDB query to execute
  - All queries are executed with read-only permissions

- **aggregate**
  - Execute read-only MongoDB queries against the connected database
  - Input: `aggregate` (object): The MongoDB query to execute
  - All queries are executed with read-only permissions

### Prompts
- `query` - Provide insights about the collection's structure, data types, and basic statistics
  - Input: `collection` (string): The name of the collection to analyze
  - Output: `text` (string): A summary of the collection's structure, data types, and basic statistics
- `aggregate` - Provide insights about the collection's structure, data types, and basic statistics
  - Input: `collection` (string): The name of the collection to analyze
  - Output: `text` (string): A summary of the collection's structure, data types, and basic statistics



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
    }
  }
}
```

### Installing via Smithery

To install MCP MongoDB Server for Claude Desktop automatically via [Smithery](https://smithery.ai/protocol/mcp-mongo-server):

```bash
npx @smithery/cli install mcp-mongo-server --client claude
```

### Installing via mcp-get

You can install this package using mcp-get:

```bash
npx @michaellatman/mcp-get@latest install mcp-mongo-server
```

Replace `/sample_namespace` with your database name.

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
