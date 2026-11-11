import { test } from "bun:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { Connections } from "../src/connections.js";

const defaultUri = "mongodb://127.0.0.1:37017/mcp_test";
const replicaUri = "mongodb://127.0.0.1:37018/mcp_test?directConnection=true";

function createConnections(secondaryUri: string) {
  return new Connections(
    defaultUri,
    JSON.stringify({ secondary: { uri: secondaryUri } }),
    false,
  );
}

test("concurrent first requests share one secondary MongoClient", async () => {
  const connections = createConnections(replicaUri);
  try {
    await connections.resolve();
    const targets = await Promise.all(
      Array.from({ length: 8 }, () =>
        connections.resolve({ connectionId: "secondary" }),
      ),
    );
    const { client, db } = targets[0];
    for (const target of targets) assert.equal(target.client, client);
    const hello = await db.command({ hello: 1 });
    assert.equal(hello.setName, "mcp-test");
    const closed = once(client, "topologyClosed");
    await connections.close();
    await closed;
  } finally {
    await connections.close();
  }
});

test("shutdown cleans up an in-flight secondary connection", async () => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const connections = createConnections(
    `mongodb://127.0.0.1:${address.port}/mcp_test?serverSelectionTimeoutMS=750&connectTimeoutMS=500`,
  );
  const accepted = once(listener, "connection");
  const resolving = assert.rejects(
    connections.resolve({ connectionId: "secondary" }),
    /Failed to connect.*secondary/,
  );
  try {
    const [socket] = await accepted;
    socket.resume();
    const disconnected = once(socket, "close");
    const closing = connections.close();
    await assert.rejects(connections.resolve(), /shutting down/);
    await Promise.all([resolving, closing, disconnected]);
  } finally {
    await connections.close();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});
