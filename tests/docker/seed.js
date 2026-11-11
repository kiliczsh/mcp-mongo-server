const standalone = new Mongo("mongodb://standalone:27017");
const replica = new Mongo("mongodb://replica:27017/?directConnection=true");
const admin = replica.getDB("admin");

if (!admin.runCommand({ hello: 1 }).setName) {
  admin.runCommand({
    replSetInitiate: {
      _id: "mcp-test",
      members: [{ _id: 0, host: "replica:27017" }],
    },
  });
}

const electionDeadline = Date.now() + 30000;
while (!admin.runCommand({ hello: 1 }).isWritablePrimary) {
  if (Date.now() >= electionDeadline) {
    throw new Error("Replica set did not elect a primary");
  }
  sleep(500);
}

for (const connection of [standalone, replica]) {
  const database = connection.getDB("mcp_test");
  const bookId = ObjectId("675dbc255bd793b887b4db0a");
  database.getCollection("books").replaceOne(
    { _id: bookId },
    {
      _id: bookId,
      title: "Example book",
      publishedAt: ISODate("2025-01-01T00:00:00Z"),
    },
    { upsert: true },
  );
  database.getCollection("loans").replaceOne(
    { _id: "loan-1" },
    { _id: "loan-1", book: bookId, returnedAt: null },
    { upsert: true },
  );
  for (const name of ["events#archive", "logs 2026"]) {
    database.getCollection(name).replaceOne(
      { _id: "fixture" },
      { _id: "fixture", collection: name },
      { upsert: true },
    );
  }
  connection.getDB("mcp_test_secondary").getCollection("books").replaceOne(
    { _id: bookId },
    { _id: bookId, title: "Cross-database fixture" },
    { upsert: true },
  );
}
