# MCP MongoDB Server
---

![NPM Version](https://img.shields.io/npm/v/mcp-mongo-server)
![NPM Downloads](https://img.shields.io/npm/dm/mcp-mongo-server)
![NPM License](https://img.shields.io/npm/l/mcp-mongo-server)

A Model Context Protocol (MCP) server that lets AI assistants work with your MongoDB databases. It exposes your collections, infers their schemas, and runs queries, aggregations, and writes through a standard interface — so tools like Claude Desktop and Cursor can read and reason about your data.

## Demo

[![MCP MongoDB Server Demo | Claude Desktop](https://img.youtube.com/vi/FI-oE_voCpA/0.jpg)](https://www.youtube.com/watch?v=FI-oE_voCpA)

## Why use it

- **Talk to your database in plain language** — the assistant discovers your collections and their shape automatically.
- **Safe by default** — turn on read-only mode to let an assistant explore without any risk of changing data.
- **Works everywhere** — connects to standalone, replica set, sharded, and Atlas deployments, over plain or TLS connections.

## Key Features

- **Read-Only Mode** — blocks every write path (insert, update, index creation, and aggregation stages like `$out`/`$merge` that could modify data).
- **Smart ObjectId Handling** — configurable `auto`/`none`/`force` conversion of 24-character hex strings to ObjectIds.
- **Schema Inference** — automatic collection schema detection from document samples.
- **Query & Aggregation** — full query and aggregation pipeline support, with optional `explain` plans.
- **Write Operations** — insert, update, and index creation (when read-only mode is off).
- **Time Conversion** — a `convertTime` helper turns Unix timestamps and date strings into UTC/GMT/ISO, so date queries stay unambiguous across timezones.
- **Progress & Cancellation** — long operations report progress and can be cancelled mid-flight.
- **Two Transports** — run locally over stdio, or expose an HTTP endpoint for remote access.

## Requirements

- Node.js 20 or newer

## Quick Start

Point the server at your database — no install step needed:

```bash
npx -y mcp-mongo-server mongodb://localhost:27017/mydatabase
```

Explore safely, without any chance of changing data:

```bash
npx -y mcp-mongo-server mongodb://localhost:27017/mydatabase --read-only
```

## Usage

### Local (stdio)

This is the default, used by Claude Desktop, Cursor, and other local clients:

```bash
npx -y mcp-mongo-server "mongodb://user:pass@localhost:27017/mydatabase"
```

### Remote (HTTP)

Expose an HTTP endpoint at `/mcp` for remote or multi-client access:

```bash
npx -y mcp-mongo-server "mongodb://user:pass@localhost:27017/mydatabase" --transport http --port 3001
```

By default, only requests without a browser `Origin` (CLIs, IDEs) and requests
from `localhost` are accepted; everything else is rejected with `403` to guard
against DNS-rebinding attacks. Allow specific browser origins with
`--allowed-origins`:

```bash
npx -y mcp-mongo-server "mongodb://..." --transport http --port 3001 --allowed-origins "https://app.example.com"
```

### Options

| Flag | Description |
|------|-------------|
| `--read-only`, `-r` | Block all write operations |
| `--allow-cross-db` | Allow aggregation `$out`/`$merge`/`$lookup` to target other databases (off by default) |
| `--allow-server-js` | Allow server-side JavaScript operators `$function`/`$where`/`$accumulator` (off by default) |
| `--transport`, `-t` | `stdio` (default) or `http` |
| `--port`, `-p` | HTTP port (default `3001`) |
| `--allowed-origins` | Comma-separated browser origins to allow in HTTP mode |
| `--json-limit` | Max HTTP request body size (default `10mb`) |
| `--auth-token` | Require `Authorization: Bearer <token>` on the HTTP endpoint |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MCP_MONGODB_URI` | MongoDB connection URI (alternative to the argument) |
| `MCP_MONGODB_CONNECTIONS` | JSON object of named MongoDB connections and their database permissions |
| `MCP_MONGODB_READONLY` | Enable read-only mode (`"true"`) |
| `MCP_MONGODB_ALLOW_CROSS_DB` | Allow cross-database aggregation stages (`"true"`) |
| `MCP_MONGODB_ALLOW_SERVER_JS` | Allow server-side JavaScript operators (`"true"`) |
| `MCP_PORT` | HTTP port |
| `MCP_HTTP_ALLOWED_ORIGINS` | Comma-separated browser origins to allow in HTTP mode |
| `MCP_HTTP_JSON_LIMIT` | Max HTTP request body size (default `10mb`) |
| `MCP_HTTP_AUTH_TOKEN` | Bearer token required to access the HTTP endpoint |

### Named connections

Set `MCP_MONGODB_CONNECTIONS` to a JSON string. This MCP client configuration
uses a local build and the two [Docker test databases](docs/development.md#local-mongodb-test-environment).

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-mongo-server/build/index.js"
      ],
      "env": {
        "MCP_MONGODB_CONNECTIONS": "{\"default\":{\"uri\":\"mongodb://127.0.0.1:37017/mcp_test\"},\"analytics\":{\"uri\":\"mongodb://127.0.0.1:37018/mcp_test?directConnection=true\",\"databases\":[\"mcp_test\",\"mcp_test_secondary\"],\"readOnly\":true}}"
      }
    }
  }
}
```

- Discover targets with `listConnections` and `listDatabases`. Pass `connectionId` and `database` to database tools and the collection analysis prompt. Omitted selectors use the `default` connection and its URI database.
- Omit `databases` to allow only the URI database. If supplied, the list must include the URI database. Global read-only mode applies to every connection.
- A positional URI or `MCP_MONGODB_URI` can supply `default` when the JSON contains only secondary connections. Named connections default to a 5-second server selection timeout. Set `serverSelectionTimeoutMS` in the URI to override it.
- If a connection is offline, `resources/list` reports its ID and fails. Tools targeting other connections remain usable.

## Security

**Database scope.** The server operates on the selected database.
Named connections restrict selection to their configured databases.
Aggregation stages that reach another database (`$out`, `$merge`,
`$lookup` with an explicit `db`) are rejected by default, so a pipeline can't
quietly read from or write to databases you didn't point it at. Enable them
with `--allow-cross-db` if you need them. Named connections still enforce their
database allowlist.

**Server-side JavaScript.** The operators `$function`, `$where`, and
`$accumulator` are blocked by default in aggregation pipelines and in the
filters for `query`, `count`, and `update`. In read-write mode,
`--allow-server-js` enables these operators.

**Read-only mode** blocks writes, including the `$out` and `$merge`
aggregation stages. It also blocks server-side JavaScript even when
`--allow-server-js` is set.

**Least privilege.** Application-level checks only go so far — the strongest
guarantee comes from the database. Connect with a MongoDB user scoped to just
the database you need, with read-only permissions when the assistant only needs
to explore. That way the database itself enforces the boundary, as defense in
depth.

## Documentation

- [Integration Guide](docs/integration.md) — Claude Desktop, Windsurf, Cursor, Docker
- [Available Tools](docs/tools.md) — query, aggregate, update, insert, and more
- [Development](docs/development.md) — setup, scripts, and debugging
- [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE) for details.
