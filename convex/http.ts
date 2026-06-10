import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

// === Agent API ===
// Token-gated CRUD over the single user's todos/projects/labels so external
// agents can manage the list without a browser session. Auth is a static bearer
// token (AGENT_API_TOKEN, set via `npx convex env set`). Served on the backend's
// HTTP-actions ("site") origin, e.g. http://narishima.7811.net:30013/api/todos.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function checkAuth(request: Request): Response | null {
  const expected = process.env.AGENT_API_TOKEN;
  if (!expected) return json({ error: "AGENT_API_TOKEN not configured" }, 500);
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

http.route({
  path: "/api/todos",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const onlyIncomplete =
      new URL(request.url).searchParams.get("incomplete") === "true";
    const todos = await ctx.runQuery(internal.agentApi.listTodos, {
      onlyIncomplete,
    });
    return json({ todos });
  }),
});

http.route({
  path: "/api/todos",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (!body?.taskName) return json({ error: "taskName is required" }, 400);
    const taskId = await ctx.runAction(
      internal.agentApi.createTodoWithEmbedding,
      {
        taskName: body.taskName,
        description: body.description,
        priority: body.priority,
        dueDate: body.dueDate,
        projectId: body.projectId as Id<"projects"> | undefined,
        labelId: body.labelId as Id<"labels"> | undefined,
      }
    );
    return json({ taskId }, 201);
  }),
});

http.route({
  path: "/api/todos",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (!body?.taskId) return json({ error: "taskId is required" }, 400);
    const taskId = await ctx.runMutation(internal.agentApi.updateTodo, {
      taskId: body.taskId as Id<"todos">,
      taskName: body.taskName,
      description: body.description,
      priority: body.priority,
      dueDate: body.dueDate,
      isCompleted: body.isCompleted,
    });
    return json({ taskId });
  }),
});

http.route({
  path: "/api/todos",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (!body?.taskId) return json({ error: "taskId is required" }, 400);
    const taskId = await ctx.runMutation(internal.agentApi.removeTodo, {
      taskId: body.taskId as Id<"todos">,
    });
    return json({ taskId });
  }),
});

http.route({
  path: "/api/projects",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const projects = await ctx.runQuery(internal.agentApi.listProjects, {});
    return json({ projects });
  }),
});

http.route({
  path: "/api/projects",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return json({ error: "name is required" }, 400);
    const projectId = await ctx.runMutation(internal.agentApi.insertProject, {
      name: body.name,
    });
    return json({ projectId }, 201);
  }),
});

http.route({
  path: "/api/labels",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const labels = await ctx.runQuery(internal.agentApi.listLabels, {});
    return json({ labels });
  }),
});

http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({
        issuer: process.env.CONVEX_SITE_URL,
        jwks_uri: process.env.CONVEX_SITE_URL + "/.well-known/jwks.json",
        authorization_endpoint:
          process.env.CONVEX_SITE_URL + "/oauth/authorize",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
        },
      }
    );
  }),
});

http.route({
  path: "/.well-known/jwks.json",
  method: "GET",
  handler: httpAction(async () => {
    if (process.env.JWKS === undefined) {
      throw new Error("Missing JWKS Convex environment variable");
    }
    return new Response(process.env.JWKS, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
      },
    });
  }),
});

export default http;
