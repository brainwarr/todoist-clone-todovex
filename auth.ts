import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { fetchQuery } from "convex/nextjs";
import { importPKCS8, SignJWT } from "jose";
import { api } from "./convex/_generated/api";

// === Single-user, self-hosted deployment ===
// Google OAuth has been replaced with a single Credentials user (configured via
// env). The Convex JWT machinery (RS256 signing + JWKS validation) is unchanged;
// we only change how Next.js decides who you are. The signed `convexToken` still
// carries `sub: <convex users._id>`, which Convex resolves via
// `getUserIdentity().subject` in `handleUserId`.

// The HTTP-actions ("site") origin of the self-hosted backend, e.g.
// http://narishima.7811.net:30013 — this is the JWT issuer and where the JWKS
// is served (convex/http.ts). Set explicitly instead of the upstream
// ".cloud" → ".site" string munging, which assumes Convex Cloud hostnames.
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL!;

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const okUser = credentials?.username === process.env.TODOVEX_USER;
        const okPass = credentials?.password === process.env.TODOVEX_PASSWORD;
        if (!okUser || !okPass) return null;

        // The single user row is seeded by convex/seed.ts. Resolve its Convex
        // _id so the session JWT's `sub` matches what Convex functions expect.
        const user = await fetchQuery(api.users.getSingleUser, {});
        if (!user) {
          console.error("No seeded user found — run the Convex seed mutation");
          return null;
        }
        return { id: user._id, email: user.email, name: user.name ?? "Me" };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On sign-in, persist the Convex user _id onto the token.
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      const userId = token.sub!;
      (session as any).userId = userId;

      const privateKey = await importPKCS8(
        process.env.CONVEX_AUTH_PRIVATE_KEY!,
        "RS256"
      );

      const convexToken = await new SignJWT({
        sub: userId,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuedAt()
        .setIssuer(CONVEX_SITE_URL)
        .setAudience("convex")
        .setExpirationTime("1h")
        .sign(privateKey);

      return { ...session, convexToken };
    },
  },
});

declare module "next-auth" {
  interface Session {
    convexToken: string;
    userId: string;
  }
}
