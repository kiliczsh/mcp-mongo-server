import { z } from "zod";
import {
    CallToolRequestSchema,
    ToolSchema,
    ResourceSchema,
    TextResourceContentsSchema,
} from "@modelcontextprotocol/sdk/types.js";

// MongoDB Collection Schema
export const MongoCollectionSchema = ResourceSchema.extend({
    collectionName: z.string(),
    databaseName: z.string(),
    indexes: z.array(z.object({
        name: z.string(),
        keys: z.record(z.union([z.number(), z.string()])),
        unique: z.optional(z.boolean()),
    })).optional(),
});

export type MongoCollection = z.infer<typeof MongoCollectionSchema>;

// MongoDB Document Schema
export const MongoDocumentSchema = TextResourceContentsSchema.extend({
    document: z.record(z.unknown()),
});

export type MongoDocument = z.infer<typeof MongoDocumentSchema>;

// MongoDB Query Operators
export const MongoQueryOperatorSchema = z.object({
    $eq: z.unknown().optional(),
    $gt: z.unknown().optional(),
    $gte: z.unknown().optional(),
    $in: z.array(z.unknown()).optional(),
    $lt: z.unknown().optional(),
    $lte: z.unknown().optional(),
    $ne: z.unknown().optional(),
    $nin: z.array(z.unknown()).optional(),
    $and: z.array(z.unknown()).optional(),
    $not: z.unknown().optional(),
    $nor: z.array(z.unknown()).optional(),
    $or: z.array(z.unknown()).optional(),
    $exists: z.boolean().optional(),
    $type: z.union([z.string(), z.number()]).optional(),
    $expr: z.unknown().optional(),
    $regex: z.string().optional(),
    $options: z.string().optional(),
});

export type MongoQueryOperator = z.infer<typeof MongoQueryOperatorSchema>;

// MongoDB Sort Options
export const MongoSortSchema = z.record(z.union([z.literal(1), z.literal(-1)]));

export type MongoSort = z.infer<typeof MongoSortSchema>;

// MongoDB Query Tool Schema
export const MongoQueryToolSchema = ToolSchema.extend({
    inputSchema: z.object({
        type: z.literal("object"),
        properties: z.object({
            collection: z.string(),
            filter: z.record(z.union([z.unknown(), MongoQueryOperatorSchema])),
            projection: z.record(z.union([z.literal(0), z.literal(1)])).optional(),
            sort: MongoSortSchema.optional(),
            limit: z.number().int().positive().optional(),
            skip: z.number().int().nonnegative().optional(),
        }).passthrough(),
        required: z.array(z.literal("collection")),
    }),
});

export type MongoQueryTool = z.infer<typeof MongoQueryToolSchema>;

// MongoDB Aggregate Tool Schema
export const MongoAggregateToolSchema = ToolSchema.extend({
    inputSchema: z.object({
        type: z.literal("object"),
        properties: z.object({
            collection: z.string(),
            pipeline: z.array(z.record(z.unknown())),
        }).passthrough(),
        required: z.array(z.literal("collection")),
    }),
});

export type MongoAggregateTool = z.infer<typeof MongoAggregateToolSchema>;

// MongoDB Count Tool Schema
export const MongoCountToolSchema = ToolSchema.extend({
    inputSchema: z.object({
        type: z.literal("object"),
        properties: z.object({
            collection: z.string(),
            filter: z.record(z.union([z.unknown(), MongoQueryOperatorSchema])).optional(),
        }).passthrough(),
        required: z.array(z.literal("collection")),
    }),
});

export type MongoCountTool = z.infer<typeof MongoCountToolSchema>;

// MongoDB Distinct Tool Schema
export const MongoDistinctToolSchema = ToolSchema.extend({
    inputSchema: z.object({
        type: z.literal("object"),
        properties: z.object({
            collection: z.string(),
            field: z.string(),
            filter: z.record(z.union([z.unknown(), MongoQueryOperatorSchema])).optional(),
        }).passthrough(),
        required: z.array(z.literal("collection")),
    }),
});

export type MongoDistinctTool = z.infer<typeof MongoDistinctToolSchema>;

// MongoDB Call Tool Request Schema
export const MongoCallToolRequestSchema = CallToolRequestSchema.extend({
    params: z.object({
        name: z.enum(["query", "aggregate", "count", "distinct", "listCollections"]),
        arguments: z.union([
            MongoQueryToolSchema.shape.inputSchema,
            MongoAggregateToolSchema.shape.inputSchema,
            MongoCountToolSchema.shape.inputSchema,
            MongoDistinctToolSchema.shape.inputSchema,
        ]),
    }),
});

export type MongoCallToolRequest = z.infer<typeof MongoCallToolRequestSchema>;

// MongoDB Error Types
export const MongoErrorCodeSchema = z.enum([
    "INVALID_QUERY",
    "COLLECTION_NOT_FOUND",
    "DATABASE_NOT_FOUND",
    "INVALID_PIPELINE",
    "INVALID_PROJECTION",
    "INVALID_SORT",
    "CONNECTION_ERROR",
    "TIMEOUT",
    "UNAUTHORIZED",
]);

export type MongoErrorCode = z.infer<typeof MongoErrorCodeSchema>;

export const MongoErrorSchema = z.object({
    code: MongoErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
});

export type MongoError = z.infer<typeof MongoErrorSchema>;

// MongoDB Schema Inference Types
export const MongoFieldSchemaSchema: z.ZodType<any> = z.object({
    type: z.union([
        z.literal("string"),
        z.literal("number"),
        z.literal("boolean"),
        z.literal("date"),
        z.literal("objectId"),
        z.literal("array"),
        z.literal("object"),
        z.literal("null"),
        z.literal("mixed"),
    ]),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    indexed: z.boolean().optional(),
    items: z.lazy(() => MongoFieldSchemaSchema).optional(),
    properties: z.record(z.lazy(() => MongoFieldSchemaSchema)).optional(),
});

export type MongoFieldSchema = z.infer<typeof MongoFieldSchemaSchema>;

export const MongoCollectionSchemaSchema = z.object({
    name: z.string(),
    fields: z.record(MongoFieldSchemaSchema),
    options: z.object({
        timestamps: z.boolean().optional(),
        strict: z.boolean().optional(),
    }).optional(),
});

export type MongoCollectionSchema = z.infer<typeof MongoCollectionSchemaSchema>;