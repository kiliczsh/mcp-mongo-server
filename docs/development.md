# Development

## Setup

```bash
git clone https://github.com/kiliczsh/mcp-mongo-server.git
cd mcp-mongo-server

bun install
bun run build
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run build` | Build the project |
| `bun run clean` | Remove build output |
| `bun run watch` | Dev mode with auto-rebuild |
| `bun run format` | Format code with Biome |
| `bun run format:check` | Check formatting |
| `bun run lint` | Lint code with Biome |
| `bun run lint:fix` | Lint and auto-fix |
| `bun run check` | Format + lint + import sorting |
| `bun run inspector` | Launch MCP Inspector |

## Debugging

Since MCP servers communicate over stdio, debugging can be challenging. Use the MCP Inspector for better visibility:

```bash
# Copy and edit the config with your MongoDB URI
cp inspector-config.example.json inspector-config.json

# Launch inspector
bun run inspector
```

This will provide a URL to access the debugging tools in your browser.

## Local MongoDB test environment

Start the MongoDB 8.0 standalone and single-node replica set from the repository root:

```sh
docker compose -f compose.test.yml up -d
docker compose -f compose.test.yml wait seed
```

The seed service exits with status 0 after both databases contain the fixtures.

| Topology | Host connection URI |
| --- | --- |
| Standalone | `mongodb://127.0.0.1:37017/mcp_test` |
| Replica set | `mongodb://127.0.0.1:37018/mcp_test?directConnection=true&replicaSet=mcp-test` |

Use either URI as `MCP_MONGODB_URI`. Both servers also contain `mcp_test_secondary` for cross-database checks. The fixtures include ObjectId references, BSON dates, and collection names containing spaces or `#`. The ports bind to loopback and the databases use no credentials.

Stop the environment and keep its volumes with `docker compose -f compose.test.yml down`.
