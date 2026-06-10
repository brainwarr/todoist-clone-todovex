import { mutation } from "./_generated/server";
import { v } from "convex/values";

// One-time idempotent seed for the single-user self-hosted deployment.
// Creates: the single user row, a default "Personal" project, and the system
// labels (including "AI", which the AI-suggest actions attach to generated
// todos). Safe to run multiple times — it no-ops if the user already exists.
//
// Invoke after the first deploy, e.g.:
//   npx convex run seed:seed '{"email":"you@example.com","name":"Me"}'
export const seed = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { email, name }) => {
    const existing = await ctx.db.query("users").first();
    if (existing) {
      return { userId: existing._id, created: false };
    }

    const userId = await ctx.db.insert("users", {
      email,
      name: name ?? "Me",
      emailVerified: Date.now(),
    });

    // Default project for unfiled tasks.
    await ctx.db.insert("projects", {
      userId,
      name: "Personal",
      type: "system",
    });

    // System labels. "AI" is required by convex/openai.ts (the AI-suggest
    // actions look it up by name and attach it to generated todos).
    for (const labelName of ["AI", "Work", "Personal", "Urgent"]) {
      await ctx.db.insert("labels", {
        userId,
        name: labelName,
        type: "system",
      });
    }

    return { userId, created: true };
  },
});
