//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const query: EvalFunction = {
    name: "query",
    description: "Evaluates the query tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Can you query the employees collection for documents with a salary above 50000?");
        return JSON.parse(result);
    }
};

const aggregate: EvalFunction = {
    name: "aggregate",
    description: "Evaluates the aggregate tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Can you run an aggregation pipeline to group employees by department and calculate the average salary?");
        return JSON.parse(result);
    }
};

const update: EvalFunction = {
    name: "update",
    description: "Evaluates the update tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Can you update all employees in the Sales department by increasing their salary by 1000?");
        return JSON.parse(result);
    }
};

const serverInfo: EvalFunction = {
    name: "serverInfo",
    description: "Evaluates the serverInfo tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "What version of MongoDB is running and what storage engine does it use?");
        return JSON.parse(result);
    }
};

const insert: EvalFunction = {
    name: "insert",
    description: "Evaluates the insert tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Can you insert a new document for an employee named Alice with a salary of 75000 in the employees collection?");
        return JSON.parse(result);
    }
};

const createIndex: EvalFunction = {
    name: "createIndex",
    description: "Evaluates the createIndex tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Can you create a unique index on the employees collection for the email field?");
        return JSON.parse(result);
    }
};

const count: EvalFunction = {
    name: "count",
    description: "Evaluates the count tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "How many documents in the employees collection have a salary greater than 60000?");
        return JSON.parse(result);
    }
};

const listCollections: EvalFunction = {
    name: "listCollections",
    description: "Evaluates the listCollections tool",
    run: async () => {
        const result = await grade(openai("gpt-4"), "What collections currently exist in the database?");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [query, aggregate, update, serverInfo, insert, createIndex, count, listCollections]
};
  
export default config;
  
export const evals = [query, aggregate, update, serverInfo, insert, createIndex, count, listCollections];