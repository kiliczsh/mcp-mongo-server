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
| `bun run test:connections` | Run the Docker connection suite with MCP 2026-07-28 |
| `bun run test:connections:legacy` | Run the same suite with legacy MCP |
| `bun run check` | Format + lint + import sorting |
| `bun run inspector` | Launch MCP Inspector |

## Debugging

Since MCP servers communicate over stdio, debugging can be challenging. Use the MCP Inspector for better visibility:

```bash
# Copy and edit the config with your MongoDB URI
cp examples/inspector-config.jsonc inspector-config.json

# Launch inspector
bun run inspector
```

This will provide a URL to access the debugging tools in your browser.

## Local MongoDB test environment

Start the MongoDB 8.0 test instances from the repository root:

```sh
docker compose -f compose.test.yml up -d
docker compose -f compose.test.yml wait seed
bun run build
bun run test:connections
bun run test:connections:legacy
```

| Topology | Host connection URI |
| --- | --- |
| Standalone | `mongodb://127.0.0.1:37017/mcp_test` |
| Replica set | `mongodb://127.0.0.1:37018/mcp_test?directConnection=true&replicaSet=mcp-test` |

The compose file also starts a temporary authenticated MongoDB on port `37019`
for role tests. The suite cleans up its databases and test user after each run.

Stop the environment and keep its volumes with `docker compose -f compose.test.yml down`.
