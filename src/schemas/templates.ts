import type { ListResourceTemplatesRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Db, MongoClient } from "mongodb";

export async function handleListResourceTemplatesRequest({
  request,
  client,
  db,
  isReadOnlyMode,
}: {
  request: ListResourceTemplatesRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
}) {
  return {
    resourceTemplates: [
      {
        name: "mongodb_query",
        description: "Template for constructing MongoDB queries",
        uriTemplate: "mongodb:///{collection}",
        text: `To query MongoDB collections, you can use these operators:

Filter operators:
- $eq: Matches values equal to a specified value
- $gt/$gte: Matches values greater than (or equal to) a specified value
- $lt/$lte: Matches values less than (or equal to) a specified value
- $in: Matches any of the values in an array
- $nin: Matches none of the values in an array
- $ne: Matches values not equal to a specified value
- $exists: Matches documents that have the specified field

Example queries:
1. Find documents where age > 21:
{ "age": { "$gt": 21 } }

2. Find documents with specific status:
{ "status": { "$in": ["active", "pending"] } }

3. Find documents with existing email:
{ "email": { "$exists": true } }

4. Find documents with dates:
// Using ISO date string format
{ "createdAt": { "$gt": "2023-01-01T00:00:00Z" } }
// Using ISODate syntax
{ "createdAt": { "$gt": ISODate("2023-01-01T00:00:00Z") } }

Use these patterns to construct MongoDB queries.`,
      },
    ],
  };
}
