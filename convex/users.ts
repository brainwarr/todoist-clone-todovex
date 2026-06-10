import { query } from "./_generated/server";

// Single-user deployment: returns the one seeded user (or null if the seed
// hasn't run yet). Used by the NextAuth Credentials provider to resolve the
// Convex `users._id` for the session JWT `sub`.
export const getSingleUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.query("users").first();
    if (!user) return null;
    return { _id: user._id, email: user.email, name: user.name };
  },
});
