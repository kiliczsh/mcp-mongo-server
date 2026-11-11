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
    deployment.client = await MongoClient.connect(uri(deployment), {
      serverSelectionTimeoutMS: 3000,
    });
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

  authenticatedAdmin = await MongoClient.connect(
    `mongodb://test-admin:test-admin-password@${authenticatedHost}/admin`,
    { serverSelectionTimeoutMS: 3000 },
  );
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
        const { tools } = await client.listTools();
        for (const name of ["insert", "update", "createIndex"]) {
          assert.equal(
            tools.some((tool) => tool.name === name),
            false,
          );
        }
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

  test(`write tools stay discoverable with a read-only default over ${transport}`, {
    timeout: 30000,
  }, async () => {
    const configuration = namedConfiguration();
    const entries = JSON.parse(configuration.env.MCP_MONGODB_CONNECTIONS);
    entries.default.readOnly = true;
    entries.analytics.readOnly = false;
    configuration.env.MCP_MONGODB_CONNECTIONS = JSON.stringify(entries);
    await withServer(transport, configuration, async (client) => {
      const { tools } = await client.listTools();
      for (const name of ["insert", "update", "createIndex"]) {
        const tool = tools.find((tool) => tool.name === name);
        assert.equal(tool.annotations.readOnlyHint, false);
        assert.match(tool.description, /listConnections/);
      }
      const args = {
        collection,
        filter: { _id: "same-id" },
        update: { $set: { changed: false } },
      };
      await expectToolError(client, "update", args);
      assert.equal(
        (await data(client, "update", { ...args, connectionId: "analytics" }))
          .matchedCount,
        1,
      );
    });
  });

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
    const { tools } = await client.listTools();
    assert.ok(
      tools.every(
        ({ name }) => !["insert", "update", "createIndex"].includes(name),
      ),
    );
    assert.equal(
      tools.find(({ name }) => name === "aggregate").annotations.readOnlyHint,
      true,
    );
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

function mongoProxy(upstreamPort) {
  let stalled = false;
  const sockets = new Set();
  const server = net.createServer((downstream) => {
    const upstream = net.connect(upstreamPort, "127.0.0.1");
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
    downstream.pipe(upstream);
    upstream.on("data", (chunk) => {
      if (!stalled) downstream.write(chunk);
    });
  });
  return {
    server,
    stallReplies() {
      stalled = true;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}

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
  const proxy = mongoProxy(37018);
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
      proxy.server.listen(port, "127.0.0.1");
      await once(proxy.server, "listening");
      const result = await data(client, "query", {
        connectionId: "analytics",
        collection,
      });
      assert.equal(result.results[0].origin, `analytics/${mainDatabase}`);
    });
  } finally {
    await proxy.close();
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

for (const transport of ["stdio", "http"]) {
  test(`query timeout while MongoDB is waiting to reply over ${transport}`, {
    timeout: 30000,
  }, async () => {
    const configuration = namedConfiguration();
    const entries = JSON.parse(configuration.env.MCP_MONGODB_CONNECTIONS);
    const proxies = deployments.map(({ port }) => mongoProxy(port));
    try {
      for (const [index, { id, port }] of deployments.entries()) {
        const { server } = proxies[index];
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        entries[id].uri = entries[id].uri.replace(
          `:${port}/`,
          `:${server.address().port}/`,
        );
      }
      configuration.env.MCP_MONGODB_CONNECTIONS = JSON.stringify(entries);
      configuration.env.MCP_MONGODB_QUERY_TIMEOUT_MS = "250";
      await withServer(transport, configuration, async (client) => {
        for (const [index, { id }] of deployments.entries()) {
          const args = { connectionId: id, collection, includeTotal: false };
          assert.equal((await data(client, "query", args)).results.length, 1);
          proxies[index].stallReplies();
          const result = await client.callTool(
            { name: "query", arguments: args },
            { timeout: 2000 },
          );
          assert.equal(result.isError, true);
          assert.match(result.content[0].text, /timeout|timed out/i);
        }
      });
    } finally {
      await Promise.all(proxies.map((proxy) => proxy.close()));
    }
  });

  test(`collection inspection and bounded queries over ${transport}`, {
    timeout: 60000,
  }, async (t) => {
    const name = `inspection_${transport}`;
    for (const deployment of deployments) {
      const fixture = deployment.client.db(secondaryDatabase).collection(name);
      const origin = deployment.id;
      await fixture.insertMany([
        ...[1, 2, 3].map((_id) => ({
          _id,
          origin,
          group: "small",
          payload: "ok",
        })),
        ...[4, 5, 6].map((_id) => ({
          _id,
          origin,
          group: "wide",
          payload: "é".repeat(160),
        })),
        { _id: 7, origin, group: "oversized", payload: "é".repeat(400) },
      ]);
      await fixture.createIndex(
        { origin: 1, group: -1 },
        { name: `origin_${origin}` },
      );
    }
    const configuration = namedConfiguration();
    Object.assign(configuration.env, {
      MCP_MONGODB_MAX_RESULT_DOCUMENTS: "2",
      MCP_MONGODB_MAX_RESULT_BYTES: "512",
      MCP_MONGODB_QUERY_TIMEOUT_MS: "3000",
    });

    await withServer(transport, configuration, async (client) => {
      const { tools } = await client.listTools();
      for (const name of ["query", "aggregate"]) {
        const { description } = tools.find((tool) => tool.name === name);
        assert.match(description, /2 documents/);
        assert.match(description, /512 bytes/);
        assert.match(description, /3000 ms/);
      }
      for (const { id } of deployments) {
        const target = {
          connectionId: id,
          database: secondaryDatabase,
          collection: name,
        };

        await t.test(`index metadata comes from ${id}`, async () => {
          const { indexes } = await data(client, "listIndexes", target);
          assert.deepEqual(indexes.map(({ name }) => name).sort(), [
            "_id_",
            `origin_${id}`,
          ]);
          const index = indexes.find(({ name }) => name === `origin_${id}`);
          assert.deepEqual(Object.entries(index.key), [
            ["origin", 1],
            ["group", -1],
          ]);
        });

        await t.test(`schema matches the MCP resource on ${id}`, async () => {
          const schema = await data(client, "collectionSchema", target);
          const uri = `mongodb:///${encodeURIComponent(name)}?${new URLSearchParams(
            {
              connectionId: id,
              database: secondaryDatabase,
            },
          )}`;
          const resource = await client.readResource({ uri });
          const resourceSchema = JSON.parse(resource.contents[0].text);
          assert.equal(schema.name, name);
          assert.equal(schema.documentCount, 7);
          assert.ok(
            schema.fields
              .find((field) => field.name === "origin")
              .examples.includes(id),
          );
          const signatures = ({ fields }) =>
            fields
              .map(({ name, types, nullable, prevalence }) => ({
                name,
                types,
                nullable,
                prevalence,
              }))
              .sort((a, b) => a.name.localeCompare(b.name));
          assert.deepEqual(signatures(schema), signatures(resourceSchema));
          assert.deepEqual(schema.indexes, resourceSchema.indexes);
        });

        await t.test(
          `query keeps totals and caps documents on ${id}`,
          async () => {
            const args = {
              ...target,
              filter: { group: "small" },
              sort: { _id: 1 },
              limit: 5,
            };
            const result = await data(client, "query", args);
            assert.deepEqual(
              result.results.map(({ _id }) => _id),
              [1, 2],
            );
            assert.equal(result.metadata.total, 3);
            assert.equal(result.metadata.hasMore, true);
            assert.equal(result.metadata.truncated, "documents");
            const withoutTotal = await data(client, "query", {
              ...args,
              includeTotal: false,
            });
            assert.deepEqual(withoutTotal.results, result.results);
            assert.equal(Object.hasOwn(withoutTotal.metadata, "total"), false);
            assert.equal(withoutTotal.metadata.hasMore, true);

            const findPlan = await data(client, "query", {
              ...args,
              explain: "queryPlanner",
            });
            assert.ok(findPlan.queryPlanner);
            const aggregationPlan = await data(client, "aggregate", {
              ...target,
              pipeline: [{ $match: { group: "small" } }],
              explain: "queryPlanner",
            });
            assert.ok(Array.isArray(aggregationPlan) && aggregationPlan[0]);
          },
        );

        await t.test(
          `aggregate caps documents and UTF-8 bytes on ${id}`,
          async () => {
            const pipeline = (group) => [
              { $match: { group } },
              { $sort: { _id: 1 } },
            ];
            const small = await data(client, "aggregate", {
              ...target,
              pipeline: pipeline("small"),
            });
            assert.deepEqual(
              small.results.map(({ _id }) => _id),
              [1, 2],
            );
            assert.equal(small.metadata.truncated, "documents");
            const wide = await data(client, "aggregate", {
              ...target,
              pipeline: pipeline("wide"),
            });
            assert.deepEqual(
              wide.results.map(({ _id }) => _id),
              [4],
            );
            assert.ok(
              Buffer.byteLength(JSON.stringify(wide.results), "utf8") <= 512,
            );
            assert.equal(wide.metadata.truncated, "bytes");
            const oversized = await call(client, "query", {
              ...target,
              filter: { group: "oversized" },
            });
            assert.equal(oversized.isError, true);
            assert.match(oversized.content[0].text, /byte|projection/i);
          },
        );
      }

      await t.test("inspection uses the database allowlist", async () => {
        for (const tool of ["listIndexes", "collectionSchema"]) {
          const denied = await call(client, tool, {
            connectionId: "analytics",
            database: blockedDatabase,
            collection: name,
          });
          assert.equal(denied.isError, true);
          assert.match(denied.content[0].text, /not allowed/);
        }
      });
    });
  });
}
