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
