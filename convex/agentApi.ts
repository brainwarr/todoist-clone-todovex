import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getSingleUserId } from "./auth";
import { getEmbeddingsWithAI } from "./openai";
import { Id } from "./_generated/dataModel";

// Internal building blocks for the token-gated agent HTTP API (convex/http.ts).
// Unlike the user-facing query/mutation functions, these resolve "the user" via
// the single seeded row (getSingleUserId) rather than an auth identity, so
// agents can call them without a browser session.

async function resolveDefaults(ctx: any, userId: Id<"users">) {
  const project = await ctx.db
    .query("projects")
    .filter((q: any) => q.eq(q.field("type"), "system"))
    .first();
  const label = await ctx.db.query("labels").first();
  return {
    projectId: project?._id as Id<"projects"> | undefined,
    labelId: label?._id as Id<"labels"> | undefined,
  };
}

export const listTodos = internalQuery({
  args: { onlyIncomplete: v.optional(v.boolean()) },
  handler: async (ctx, { onlyIncomplete }) => {
    const userId = await getSingleUserId(ctx);
    if (!userId) return [];
    let q = ctx.db
      .query("todos")
      .filter((qb) => qb.eq(qb.field("userId"), userId));
    const todos = await q.collect();
    return onlyIncomplete ? todos.filter((t) => !t.isCompleted) : todos;
  },
});

export const listProjects = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getSingleUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("projects")
      .filter((q) =>
        q.or(q.eq(q.field("userId"), userId), q.eq(q.field("type"), "system"))
      )
      .collect();
  },
});

export const listLabels = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("labels").collect();
  },
});

export const insertTodo = internalMutation({
  args: {
    taskName: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    projectId: v.optional(v.id("projects")),
    labelId: v.optional(v.id("labels")),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const userId = await getSingleUserId(ctx);
    if (!userId) throw new Error("No seeded user — run the seed mutation");
    const defaults = await resolveDefaults(ctx, userId);
    const projectId = args.projectId ?? defaults.projectId;
    const labelId = args.labelId ?? defaults.labelId;
    if (!projectId || !labelId) {
      throw new Error("No default project/label — run the seed mutation");
    }
    return await ctx.db.insert("todos", {
      userId,
      taskName: args.taskName,
      description: args.description,
      priority: args.priority ?? 1,
      dueDate: args.dueDate ?? Date.now(),
      projectId,
      labelId,
      isCompleted: false,
      embedding: args.embedding,
    });
  },
});

export const updateTodo = internalMutation({
  args: {
    taskId: v.id("todos"),
    taskName: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    isCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskId, ...patch }) => {
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(taskId, clean);
    return taskId;
  },
});

export const removeTodo = internalMutation({
  args: { taskId: v.id("todos") },
  handler: async (ctx, { taskId }) => {
    await ctx.db.delete(taskId);
    return taskId;
  },
});

export const insertProject = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getSingleUserId(ctx);
    if (!userId) throw new Error("No seeded user — run the seed mutation");
    return await ctx.db.insert("projects", { userId, name, type: "user" });
  },
});

// Create a todo, computing its embedding (best-effort) so vector search
// includes agent-created items. Falls back to no embedding if LiteLLM is down.
export const createTodoWithEmbedding = internalAction({
  args: {
    taskName: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    projectId: v.optional(v.id("projects")),
    labelId: v.optional(v.id("labels")),
  },
  handler: async (ctx, args): Promise<Id<"todos">> => {
    let embedding: number[] | undefined;
    try {
      embedding = await getEmbeddingsWithAI(args.taskName);
    } catch (err) {
      console.error("Embedding failed, inserting without it:", err);
    }
    return await ctx.runMutation(internal.agentApi.insertTodo, {
      ...args,
      embedding,
    });
  },
});
