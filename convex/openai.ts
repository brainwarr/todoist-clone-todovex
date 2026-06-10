import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";

import OpenAI from "openai";
import { Id } from "./_generated/dataModel";

// === LiteLLM gateway (in-cluster) ===
// Chat + embeddings are routed through the lab's LiteLLM proxy instead of
// OpenAI directly. Set in the Convex backend env via `npx convex env set`.
const LITELLM_BASE_URL =
  process.env.LITELLM_BASE_URL ||
  "http://litellm.routing.svc.cluster.local:4000/v1";
const LITELLM_KEY = process.env.LITELLM_KEY || "";
const CHAT_MODEL = process.env.TODOVEX_CHAT_MODEL || "local-medium";
const EMBED_MODEL = process.env.TODOVEX_EMBED_MODEL || "local-embed";

const openai = new OpenAI({ apiKey: LITELLM_KEY, baseURL: LITELLM_BASE_URL });

// Local models don't reliably honour response_format:json_object, so parse
// defensively: try the whole string, then fall back to the first JSON block.
function parseTodoSuggestions(
  content: string | null | undefined
): Array<{ taskName: string; description: string }> {
  if (!content) return [];
  const tryParse = (s: string) => {
    try {
      const obj = JSON.parse(s);
      if (Array.isArray(obj)) return obj;
      if (Array.isArray(obj?.todos)) return obj.todos;
      return null;
    } catch {
      return null;
    }
  };
  let items = tryParse(content);
  if (!items) {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) items = tryParse(match[0]);
  }
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it) => it && typeof it.taskName === "string"
  ) as Array<{ taskName: string; description: string }>;
}

// Resolves the system "AI" label seeded by convex/seed.ts. Replaces the
// upstream hardcoded Convex-Cloud id that does not exist in this deployment.
export const getAiLabelId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"labels"> | null> => {
    const label = await ctx.db
      .query("labels")
      .filter((q) => q.eq(q.field("name"), "AI"))
      .first();
    return label?._id ?? null;
  },
});

export const suggestMissingItemsWithAi = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, { projectId }) => {
    const todos = await ctx.runQuery(api.todos.getTodosByProjectId, {
      projectId,
    });

    const project = await ctx.runQuery(api.projects.getProjectByProjectId, {
      projectId,
    });
    const projectName = project?.name || "";

    const response = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "I'm a project manager and I need help identifying missing to-do items. I have a list of existing tasks in JSON format, containing objects with 'taskName' and 'description' properties. I also have a good understanding of the project scope. Can you help me identify 5 additional to-do items for the project with projectName that are not yet included in this list? Please respond with ONLY a JSON object with the key 'todos' containing an array of objects with 'taskName' and 'description' properties. Ensure there are no duplicates between the existing list and the new suggestions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            todos,
            projectName,
          }),
        },
      ],
      response_format: {
        type: "json_object",
      },
      model: CHAT_MODEL,
    });

    const messageContent = response.choices[0].message?.content;
    const items = parseTodoSuggestions(messageContent);

    const AI_LABEL_ID = await ctx.runQuery(internal.openai.getAiLabelId, {});
    if (!AI_LABEL_ID) {
      console.error("AI label not found — run the seed mutation first");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const { taskName, description } = items[i];
      const embedding = await getEmbeddingsWithAI(taskName);
      await ctx.runMutation(api.todos.createATodo, {
        taskName,
        description,
        priority: 1,
        dueDate: new Date().getTime(),
        projectId,
        labelId: AI_LABEL_ID,
        embedding,
      });
    }
  },
});

export const suggestMissingSubItemsWithAi = action({
  args: {
    projectId: v.id("projects"),
    parentId: v.id("todos"),
    taskName: v.string(),
    description: v.string(),
  },
  handler: async (ctx, { projectId, parentId, taskName, description }) => {
    const todos = await ctx.runQuery(api.subTodos.getSubTodosByParentId, {
      parentId,
    });

    const project = await ctx.runQuery(api.projects.getProjectByProjectId, {
      projectId,
    });
    const projectName = project?.name || "";

    const response = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "I'm a project manager and I need help identifying missing sub tasks for a parent todo. I have a list of existing sub tasks in JSON format, containing objects with 'taskName' and 'description' properties. I also have a good understanding of the project scope. Can you help me identify 2 additional sub tasks that are not yet included in this list? Please respond with ONLY a JSON object with the key 'todos' containing an array of objects with 'taskName' and 'description' properties. Ensure there are no duplicates between the existing list and the new suggestions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            todos,
            projectName,
            ...{ parentTodo: { taskName, description } },
          }),
        },
      ],
      response_format: {
        type: "json_object",
      },
      model: CHAT_MODEL,
    });

    const messageContent = response.choices[0].message?.content;
    const items = parseTodoSuggestions(messageContent);

    const AI_LABEL_ID = await ctx.runQuery(internal.openai.getAiLabelId, {});
    if (!AI_LABEL_ID) {
      console.error("AI label not found — run the seed mutation first");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const { taskName, description } = items[i];
      const embedding = await getEmbeddingsWithAI(taskName);
      await ctx.runMutation(api.subTodos.createASubTodo, {
        taskName,
        description,
        priority: 1,
        dueDate: new Date().getTime(),
        projectId,
        parentId,
        labelId: AI_LABEL_ID,
        embedding,
      });
    }
  },
});

export const getEmbeddingsWithAI = async (searchText: string) => {
  if (!LITELLM_KEY) {
    throw new Error("LITELLM_KEY is not defined");
  }

  const req = {
    input: searchText,
    model: EMBED_MODEL,
    encoding_format: "float",
  };

  const response = await fetch(`${LITELLM_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`LiteLLM embeddings error, ${msg}`);
  }

  const json = await response.json();
  const vector = json["data"][0]["embedding"];

  console.log(`Embedding of ${searchText}: ${vector.length} dimensions`);

  return vector;
};
