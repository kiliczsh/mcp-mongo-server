import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { MongoClient } from "mongodb";

const entry = fileURLToPath(new URL("../build/index.js", import.meta.url));
const workspace = path.dirname(path.dirname(entry));
const runId = randomUUID().replaceAll("-", "");
const databaseNames = ["main", "secondary", "blocked"].map(
  (role) => `mcp_contract_${runId}_${role}`,
);
const [mainDatabase, secondaryDatabase, blockedDatabase] = databaseNames;
const principal = `reader_${runId}`;
const password = randomUUID();
const authenticatedHost = "127.0.0.1:37019";
let authenticatedAdmin;
let principalCreated = false;
const collection = "routing# sample";
const protocol =
  process.env.MCP_TEST_PROTOCOL === "legacy" ? "legacy" : { pin: "2026-07-28" };
const deployments = [
  { id: "default", port: 37017, readOnly: false },
  { id: "analytics", port: 37018, readOnly: true },
];

function uri(deployment) {
  return `mongodb://127.0.0.1:${deployment.port}/${mainDatabase}?directConnection=true`;
}

before(async () => {
  for (const deployment of deployments) {
    deployment.client = new MongoClient(uri(deployment), {
      serverSelectionTimeoutMS: 3000,
    });
    await deployment.client.connect();
    for (const database of databaseNames) {
      await deployment.client
        .db(database)
        .collection(collection)
        .insertOne({
          _id: "same-id",
          origin: `${deployment.id}/${database}`,
          changed: false,
        });
    }
  }
  const database = deployments[0].client.db(secondaryDatabase);
  for (let index = 0; index < 21; index++) {
    await database.createCollection(`paging_${String(index).padStart(2, "0")}`);
  }

  authenticatedAdmin = new MongoClient(
    `mongodb://test-admin:test-admin-password@${authenticatedHost}/admin`,
    { serverSelectionTimeoutMS: 3000 },
  );
  await authenticatedAdmin.connect();
  for (const database of databaseNames) {
    await authenticatedAdmin
      .db(database)
      .collection(collection)
      .insertOne({ origin: database });
  }
  await authenticatedAdmin.db(mainDatabase).command({
    createUser: principal,
    pwd: password,
    roles: [
      { role: "read", db: mainDatabase },
      { role: "read", db: blockedDatabase },
    ],
  });
  principalCreated = true;
});

after(async () => {
  await Promise.all(
    [...deployments, { client: authenticatedAdmin }].map(async ({ client }) => {
      if (!client) return;
      try {
        if (client === authenticatedAdmin && principalCreated) {
          await client.db(mainDatabase).command({ dropUser: principal });
        }
        for (const database of databaseNames) {
          assert.ok(database.startsWith(`mcp_contract_${runId}_`));
          await client.db(database).dropDatabase();
        }
      } finally {
        await client.close();
      }
    }),
  );
});

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  return port;
}

async function withServer(transport, configuration, run) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("MCP_")) delete env[key];
  }
  Object.assign(env, configuration.env);
  const args = [entry, ...(configuration.args ?? [])];
  const client = new Client(
    { name: "connections-acceptance", version: "1.0.0" },
    { versionNegotiation: { mode: protocol } },
  );
  let processHandle;
  let processExit;
  let stdioTransport;
  let logs = "";
  try {
    let mcpTransport;
    if (transport === "http") {
      const port = await unusedPort();
      const token = randomUUID();
      env.MCP_HTTP_AUTH_TOKEN = token;
      processHandle = spawn(
        process.execPath,
        [...args, "--transport", "http", "--port", String(port)],
        { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      processExit = once(processHandle, "exit");
      processHandle.stdout.on("data", (data) => {
        logs += data;
      });
      processHandle.stderr.on("data", (data) => {
        logs += data;
      });
      const deadline = Date.now() + 10000;
      while (!logs.includes("listening on port")) {
        assert.equal(processHandle.exitCode, null, `Server exited\n${logs}`);
        assert.ok(Date.now() < deadline, `Server startup timed out\n${logs}`);
        await delay(25);
      }
      mcpTransport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { authorization: `Bearer ${token}` } } },
      );
    } else {
      stdioTransport = new StdioClientTransport({
        command: process.execPath,
        args,
        env,
        cwd: workspace,
        stderr: "pipe",
      });
      stdioTransport.stderr?.on("data", (data) => {
        logs += data;
      });
      mcpTransport = stdioTransport;
    }
    await client.connect(mcpTransport, { timeout: 10000 });
    await run(client);
  } finally {
    try {
      await client.close();
    } finally {
      await stdioTransport?.close();
      if (processHandle && processHandle.exitCode === null)
        processHandle.kill();
      if (processExit) await processExit;
    }
  }
}

async function call(client, name, args = {}) {
  return client.callTool({ name, arguments: args }, { timeout: 8000 });
}

async function data(client, name, args = {}) {
  const result = await call(client, name, args);
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

async function expectToolError(client, name, args) {
  const result = await call(client, name, args);
  assert.equal(result.isError, true, JSON.stringify(result));
}

function namedConfiguration(globalReadOnly = false) {
  return {
    env: {
      MCP_MONGODB_READONLY: String(globalReadOnly),
      MCP_MONGODB_CONNECTIONS: JSON.stringify(
        Object.fromEntries(
          deployments.map((deployment) => [
            deployment.id,
            {
              uri: uri(deployment),
              databases: [mainDatabase, secondaryDatabase],
              readOnly: deployment.readOnly,
            },
          ]),
        ),
      ),
    },
  };
}

for (const transport of ["stdio", "http"]) {
  test(`legacy URI supplies the default alongside a named connection over ${transport}`, {
    timeout: 30000,
  }, async () => {
    const { env } = namedConfiguration();
    const { analytics } = JSON.parse(env.MCP_MONGODB_CONNECTIONS);
    const configuration = {
      env: {
        MCP_MONGODB_URI: uri(deployments[0]),
        MCP_MONGODB_CONNECTIONS: JSON.stringify({ analytics }),
      },
    };
    await withServer(transport, configuration, async (client) => {
      const defaultResult = await data(client, "query", { collection });
      assert.equal(defaultResult.results[0].origin, `default/${mainDatabase}`);
      const secondaryResult = await data(client, "query", {
        connectionId: "analytics",
        database: secondaryDatabase,
        collection,
      });
      assert.equal(
        secondaryResult.results[0].origin,
        `analytics/${secondaryDatabase}`,
      );
      assert.deepEqual((await data(client, "listDatabases")).databases, [
        mainDatabase,
      ]);
    });
  });

  test(`database discovery intersects MongoDB roles and the allowlist over ${transport}`, {
    timeout: 30000,
  }, async () => {
    const connection = {
      uri: `mongodb://${principal}:${password}@${authenticatedHost}/${mainDatabase}`,
      databases: [mainDatabase, secondaryDatabase],
    };
    const configuration = {
      env: { MCP_MONGODB_CONNECTIONS: JSON.stringify({ default: connection }) },
    };
    await withServer(transport, configuration, async (client) => {
      assert.deepEqual((await data(client, "listDatabases")).databases, [
        mainDatabase,
      ]);
      assert.equal((await data(client, "count", { collection })).count, 1);
      const driverDenied = await call(client, "count", {
        database: secondaryDatabase,
        collection,
      });
      assert.equal(driverDenied.isError, true);
      assert.match(
        driverDenied.content[0].text,
        /not authorized|unauthorized/i,
      );
      const policyDenied = await call(client, "count", {
        database: blockedDatabase,
        collection,
      });
      assert.equal(policyDenied.isError, true);
      assert.match(policyDenied.content[0].text, /not allowed/);
    });
  });

  for (const deployment of deployments) {
    test(`legacy ${deployment.id} over ${transport}`, {
      timeout: 30000,
    }, async () => {
      const configuration =
        transport === "stdio"
          ? { args: [uri(deployment), "--read-only"] }
          : {
              env: {
                MCP_MONGODB_URI: uri(deployment),
                MCP_MONGODB_READONLY: "true",
              },
            };
      await withServer(transport, configuration, async (client) => {
        const result = await data(client, "query", {
          collection,
          filter: { _id: "same-id" },
        });
        assert.equal(
          result.results[0].origin,
          `${deployment.id}/${mainDatabase}`,
        );
        assert.equal((await data(client, "count", { collection })).count, 1);
        const resource = await client.readResource({
          uri: `mongodb:///${encodeURIComponent(collection)}`,
        });
        assert.equal(JSON.parse(resource.contents[0].text).name, collection);
        const prompt = await client.getPrompt({
          name: "analyze_collection",
          arguments: { collection },
        });
        assert.ok(
          prompt.messages[0].content.text.includes(
            `${deployment.id}/${mainDatabase}`,
          ),
        );
        const completion = await client.complete({
          ref: { type: "ref/prompt", name: "analyze_collection" },
          argument: { name: "collection", value: "routing" },
        });
        assert.deepEqual(completion.completion.values, [collection]);
      });
    });
  }

  test(`named connections over ${transport}`, {
    timeout: 60000,
  }, async (t) => {
    await withServer(transport, namedConfiguration(), async (client) => {
      await t.test(
        "discovery reports permitted targets and policies",
        async () => {
          const discovered = await data(client, "listConnections");
          assert.deepEqual(discovered.connections, [
            {
              connectionId: "analytics",
              defaultDatabase: mainDatabase,
              readOnly: true,
            },
            {
              connectionId: "default",
              defaultDatabase: mainDatabase,
              readOnly: false,
            },
          ]);
          assert.ok(!JSON.stringify(discovered).includes("mongodb://"));
          for (const deployment of deployments) {
            const result = await data(client, "listDatabases", {
              connectionId: deployment.id,
            });
            assert.deepEqual(
              result.databases,
              [mainDatabase, secondaryDatabase].sort(),
            );
          }
        },
      );

      await t.test("concurrent calls keep request-local targets", async () => {
        await Promise.all(
          deployments.flatMap((deployment) =>
            [mainDatabase, secondaryDatabase].map(async (database) => {
              const result = await data(client, "query", {
                connectionId: deployment.id,
                database,
                collection,
              });
              assert.equal(
                result.results[0].origin,
                `${deployment.id}/${database}`,
              );
            }),
          ),
        );
        const fallback = await data(client, "query", { collection });
        assert.equal(fallback.results[0].origin, `default/${mainDatabase}`);
      });

      await t.test("invalid selectors return errors", async () => {
        await expectToolError(client, "query", {
          connectionId: "missing",
          collection,
        });
        await expectToolError(client, "query", {
          connectionId: "",
          collection,
        });
        await expectToolError(client, "query", {
          database: blockedDatabase,
          collection,
        });
        const forbiddenTarget = {
          connectionId: "analytics",
          database: blockedDatabase,
        };
        await assert.rejects(
          client.readResource({
            uri: `mongodb:///${encodeURIComponent(collection)}?${new URLSearchParams(forbiddenTarget)}`,
          }),
        );
        await assert.rejects(
          client.getPrompt({
            name: "analyze_collection",
            arguments: { ...forbiddenTarget, collection },
          }),
        );
      });

      await t.test(
        "writes stay in the selected writable database",
        async () => {
          await data(client, "update", {
            connectionId: "default",
            database: secondaryDatabase,
            collection,
            filter: { _id: "same-id" },
            update: { $set: { changed: true } },
          });
          await expectToolError(client, "update", {
            connectionId: "analytics",
            database: secondaryDatabase,
            collection,
            filter: { _id: "same-id" },
            update: { $set: { changed: true } },
          });
          for (const deployment of deployments) {
            for (const database of databaseNames) {
              const document = await deployment.client
                .db(database)
                .collection(collection)
                .findOne({ _id: "same-id" });
              assert.equal(
                document.changed,
                deployment.id === "default" && database === secondaryDatabase,
              );
            }
          }
        },
      );

      await t.test(
        "resources prompts and completion resolve the selected target",
        async () => {
          const target = {
            connectionId: "analytics",
            database: secondaryDatabase,
          };
          const resourceUri = `mongodb:///${encodeURIComponent(collection)}?${new URLSearchParams(target)}`;
          const resource = await client.readResource({ uri: resourceUri });
          const schema = JSON.parse(resource.contents[0].text);
          assert.ok(
            schema.fields
              .find((field) => field.name === "origin")
              .examples.includes(`analytics/${secondaryDatabase}`),
          );
          const listed = await client.listResources();
          assert.ok(listed.resources.some((item) => item.uri === resourceUri));
          assert.equal(listed.resources.length, 25);
          assert.equal(
            new Set(listed.resources.map(({ uri }) => uri)).size,
            25,
          );
          await assert.rejects(
            client.listResources({ cursor: "stale-cursor" }),
          );
          await assert.rejects(
            client.readResource({
              uri: `${resourceUri}&database=${mainDatabase}`,
            }),
          );
          const prompt = await client.getPrompt({
            name: "analyze_collection",
            arguments: { ...target, collection },
          });
          assert.ok(
            prompt.messages[0].content.text.includes(
              `analytics/${secondaryDatabase}`,
            ),
          );
          const completion = await client.complete({
            ref: { type: "ref/prompt", name: "analyze_collection" },
            argument: { name: "database", value: "mcp_contract" },
            context: { arguments: { connectionId: "analytics" } },
          });
          assert.deepEqual(
            completion.completion.values,
            [mainDatabase, secondaryDatabase].sort(),
          );
        },
      );
    });
  });
}

test("global read-only policy over http", {
  timeout: 30000,
}, async () => {
  await withServer("http", namedConfiguration(true), async (client) => {
    await expectToolError(client, "update", {
      connectionId: "default",
      collection,
      filter: { _id: "same-id" },
      update: { $set: { changed: true } },
    });
    const document = await deployments[0].client
      .db(mainDatabase)
      .collection(collection)
      .findOne({ _id: "same-id" });
    assert.equal(document.changed, false);
  });
});

test("invalid named configurations fail startup", {
  timeout: 30000,
}, async () => {
  const defaultEntry = { uri: uri(deployments[0]) };
  for (const [value, expected, legacyUri] of [
    ["{", /must be valid JSON/],
    [
      JSON.stringify({ analytics: defaultEntry }),
      /default MongoDB connection is required/,
    ],
    [
      JSON.stringify({ default: defaultEntry }),
      /named default connection conflict/,
      defaultEntry.uri,
    ],
    [
      JSON.stringify({ default: defaultEntry, "bad id": defaultEntry }),
      /Invalid connection ID/,
    ],
    [
      JSON.stringify({ default: { ...defaultEntry, readOnly: "true" } }),
      /Invalid readOnly setting/,
    ],
    [
      JSON.stringify({ default: { ...defaultEntry, databases: [] } }),
      /Invalid database allowlist/,
    ],
    [
      JSON.stringify({
        default: { ...defaultEntry, databases: [secondaryDatabase] },
      }),
      /Invalid database allowlist/,
    ],
  ]) {
    await assert.rejects(
      withServer(
        "http",
        {
          env: {
            MCP_MONGODB_CONNECTIONS: value,
            ...(legacyUri ? { MCP_MONGODB_URI: legacyUri } : {}),
          },
        },
        async () => {},
      ),
      expected,
    );
  }
});

test("an offline connection can recover without restarting the MCP server", {
  timeout: 30000,
}, async () => {
  const port = await unusedPort();
  const configuration = namedConfiguration();
  const entries = JSON.parse(configuration.env.MCP_MONGODB_CONNECTIONS);
  entries.analytics.uri =
    entries.analytics.uri.replace(":37018/", `:${port}/`) +
    "&SERVERSELECTIONTIMEOUTMS=250";
  configuration.env.MCP_MONGODB_CONNECTIONS = JSON.stringify(entries);
  const sockets = new Set();
  const proxy = net.createServer((downstream) => {
    const upstream = net.connect(37018, "127.0.0.1");
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {
        downstream.destroy();
        upstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
      });
    }
    downstream.pipe(upstream).pipe(downstream);
  });
  try {
    await withServer("http", configuration, async (client) => {
      assert.equal(
        (await data(client, "listConnections")).connections.length,
        2,
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        const offline = await client.callTool(
          {
            name: "count",
            arguments: { connectionId: "analytics", collection },
          },
          { timeout: 3000 },
        );
        assert.equal(offline.isError, true);
        assert.match(offline.content[0].text, /Failed to connect.*analytics/);
      }
      assert.equal((await data(client, "count", { collection })).count, 1);
      await assert.rejects(client.listResources(), /analytics/);
      assert.equal((await data(client, "count", { collection })).count, 1);
      proxy.listen(port, "127.0.0.1");
      await once(proxy, "listening");
      const result = await data(client, "query", {
        connectionId: "analytics",
        collection,
      });
      assert.equal(result.results[0].origin, `analytics/${mainDatabase}`);
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    if (proxy.listening) await new Promise((resolve) => proxy.close(resolve));
  }
});

test("aggregation writes respect database and connection policy", {
  timeout: 30000,
}, async () => {
  const configuration = namedConfiguration();
  configuration.env.MCP_MONGODB_ALLOW_CROSS_DB = "true";
  await withServer("http", configuration, async (client) => {
    const outputCollection = "policy_output";
    const pipeline = (db) => [{ $out: { db, coll: outputCollection } }];
    const forbidden = await call(client, "aggregate", {
      collection,
      pipeline: pipeline(blockedDatabase),
    });
    assert.equal(forbidden.isError, true);
    assert.match(forbidden.content[0].text, /outside the allowed scope/);
    await expectToolError(client, "aggregate", {
      connectionId: "analytics",
      collection,
      pipeline: pipeline(secondaryDatabase),
    });
    await data(client, "aggregate", {
      collection,
      pipeline: pipeline(secondaryDatabase),
    });
    assert.equal(
      await deployments[0].client
        .db(secondaryDatabase)
        .collection(outputCollection)
        .countDocuments(),
      1,
    );
    for (const [deployment, database] of [
      [deployments[0], blockedDatabase],
      [deployments[1], secondaryDatabase],
    ]) {
      assert.equal(
        await deployment.client
          .db(database)
          .listCollections({ name: outputCollection })
          .hasNext(),
        false,
      );
    }
  });
});
