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
| `--transport`, `-t` | `stdio` (default) or `http` |
| `--port`, `-p` | HTTP port (default `3001`) |
| `--allowed-origins` | Comma-separated browser origins to allow in HTTP mode |
| `--json-limit` | Max HTTP request body size (default `10mb`) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MCP_MONGODB_URI` | MongoDB connection URI (alternative to the argument) |
| `MCP_MONGODB_READONLY` | Enable read-only mode (`"true"`) |
| `MCP_MONGODB_ALLOW_CROSS_DB` | Allow cross-database aggregation stages (`"true"`) |
| `MCP_PORT` | HTTP port |
| `MCP_HTTP_ALLOWED_ORIGINS` | Comma-separated browser origins to allow in HTTP mode |
| `MCP_HTTP_JSON_LIMIT` | Max HTTP request body size (default `10mb`) |

## Security

**Database scope.** The server operates on the database in your connection
string. Aggregation stages that reach another database (`$out`, `$merge`,
`$lookup` with an explicit `db`) are rejected by default, so a pipeline can't
quietly read from or write to databases you didn't point it at. Enable them
with `--allow-cross-db` if you need them.

**Read-only mode** blocks every write path, including aggregation stages that
write or run server-side JavaScript (`$out`, `$merge`, `$function`, `$where`,
`$accumulator`).

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
