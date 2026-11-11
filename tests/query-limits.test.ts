import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect, createServer, type Socket } from "node:net";
import { test } from "bun:test";
import { MongoClient } from "mongodb";
import { readQueryLimits, readResultPage } from "../src/query-limits.js";
import { handleCallToolRequest } from "../src/schemas/call.js";

test("query limit configuration accepts only positive integers", () => {
  assert.equal(readQueryLimits({}).timeoutMS, undefined);
  assert.equal(
    readQueryLimits({ MCP_MONGODB_QUERY_TIMEOUT_MS: "100" }).timeoutMS,
    100,
  );
  for (const value of ["", "0", "-1", "1.5", "abc", "9007199254740992"]) {
    assert.throws(
      () => readQueryLimits({ MCP_MONGODB_QUERY_TIMEOUT_MS: value }),
      /positive integer/,
    );
  }
  assert.throws(
    () => readQueryLimits({ MCP_MONGODB_MAX_RESULT_BYTES: "1" }),
    /at least 2 bytes/,
  );
  assert.equal(readQueryLimits({ MCP_MONGODB_MAX_RESULT_BYTES: "2" }).bytes, 2);
});

test("a bounded page consumes one lookahead row and closes the cursor", async () => {
  let reads = 0;
  let closed = 0;
  const page = await readResultPage(
    {
      async next() {
        return ++reads;
      },
      async close() {
        closed++;
      },
    },
    { documents: 2 },
  );
  assert.deepEqual(page, {
    results: [1, 2],
    hasMore: true,
    truncated: "documents",
  });
  assert.equal(reads, 3);
  assert.equal(closed, 1);
});

test("cursor closes after exhaustion, byte overflow, a driver error, and cancellation", async () => {
  const failure = new Error("driver error");
  const cancelled = new AbortController();
  const abortReason = new Error("request cancelled");
  const cases = [
    { next: async () => null },
    { next: async () => "é".repeat(12), error: /byte limit/ },
    {
      next: async () => {
        throw failure;
      },
      error: failure,
    },
    {
      next: async () => {
        cancelled.abort(abortReason);
        return "row";
      },
      signal: cancelled.signal,
      error: abortReason,
    },
  ];
  for (const { next, signal, error } of cases) {
    let closed = false;
    const result = readResultPage(
      {
        next,
        async close() {
          closed = true;
        },
      },
      { bytes: 16 },
      Infinity,
      signal,
    );
    if (error) await assert.rejects(result, error);
    else assert.deepEqual(await result, { results: [], hasMore: false });
    assert.equal(closed, true);
  }
});

async function withStalledMongo(
  run: (client: MongoClient, stall: () => void) => Promise<void>,
) {
  let stalled = false;
  const sockets = new Set<Socket>();
  const proxy = createServer((downstream) => {
    const upstream = connect(37017, "127.0.0.1");
    for (const socket of [upstream, downstream]) {
      sockets.add(socket);
      socket.on("error", () => {
        upstream.destroy();
        downstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
      });
    }
    downstream.pipe(upstream);
    upstream.on("data", (bytes) => {
      if (!stalled) downstream.write(bytes);
    });
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  const client = new MongoClient(
    `mongodb://127.0.0.1:${address.port}/mcp_test?directConnection=true`,
    { monitorCommands: true, serverSelectionTimeoutMS: 2000 },
  );
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    await run(client, () => {
      stalled = true;
    });
  } finally {
    stalled = false;
    try {
      await client.close();
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }
}

function queryTool(
  client: MongoClient,
  name: string,
  args: Record<string, unknown>,
  timeoutMS?: number,
  signal?: AbortSignal,
) {
  return handleCallToolRequest({
    request: {
      method: "tools/call",
      params: { name, arguments: { collection: "books", ...args } },
    },
    client,
    db: client.db(),
    isReadOnlyMode: true,
    queryLimits: { documents: 2, timeoutMS },
    signal,
  });
}

for (const [name, args] of [
  ["query", { includeTotal: false }],
  ["query", {}],
  ["query", { explain: "queryPlanner" }],
  ["aggregate", { pipeline: [] }],
  ["aggregate", { pipeline: [], explain: "queryPlanner" }],
] as const) {
  test(`${name} ${JSON.stringify(args)} times out while waiting for MongoDB`, async () => {
    await withStalledMongo(async (client, stall) => {
      stall();
      const started = performance.now();
      const result = await queryTool(client, name, args, 200);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /timeout|timed out/i);
      assert.ok(
        performance.now() - started < 1500,
        "configured query timeout was not applied",
      );
    });
  });
}

test("cancellation interrupts an in-flight find without issuing a count", async () => {
  await withStalledMongo(async (client, stall) => {
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const commands: string[] = [];
    client.on("commandStarted", ({ commandName }) => {
      commands.push(commandName);
      if (commandName === "find") setImmediate(() => controller.abort(reason));
    });
    stall();
    await assert.rejects(
      queryTool(
        client,
        "query",
        { includeTotal: false },
        2000,
        controller.signal,
      ),
      (error) => error === reason,
    );
    assert.deepEqual(
      commands.filter((name) => name === "find" || name === "aggregate"),
      ["find"],
    );
  });
});

test("truncation releases the server-side MongoDB cursor", async () => {
  const client = new MongoClient("mongodb://127.0.0.1:37017", {
    monitorCommands: true,
  });
  const db = client.db(`mcp_query_limits_${randomUUID().replaceAll("-", "")}`);
  try {
    const collection = db.collection("rows");
    await collection.insertMany([{ value: 1 }, { value: 2 }, { value: 3 }]);
    const commands: string[] = [];
    client.on("commandStarted", ({ commandName }) => {
      commands.push(commandName);
    });
    const cursor = collection.find({}, { batchSize: 1, sort: { value: 1 } });
    const result = await readResultPage(cursor, { documents: 1 });
    assert.equal(result.results[0].value, 1);
    assert.equal(result.truncated, "documents");
    assert.deepEqual(commands, ["find", "getMore", "killCursors"]);
    assert.equal(cursor.closed, true);
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
});
