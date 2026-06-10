import { Auth } from "convex/server";
import { Id } from "./_generated/dataModel";
import { QueryCtx, MutationCtx } from "./_generated/server";

async function getViewerId(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    return null;
  }

  return identity.subject as Id<"users">;
}

export async function handleUserId(ctx: { auth: Auth }) {
  const viewerId = await getViewerId(ctx);

  if (viewerId === null) {
    console.error("user is not authenticated");
  }

  return viewerId;
}

// Single-user deployment helper: this lab runs Todovex for exactly one person,
// so the seeded `users` row is "the user". The agent HTTP API and seed logic
// resolve the active user this way instead of going through an auth identity.
export async function getSingleUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users"> | null> {
  const user = await ctx.db.query("users").first();
  return user?._id ?? null;
}
