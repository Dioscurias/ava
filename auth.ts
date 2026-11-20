import NextAuth, {type DefaultSession} from "next-auth";
import Google from "next-auth/providers/google";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {id: string};
  }
}

export const googleAuthEnabled = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const {handlers, auth, signIn, signOut} = NextAuth({
  providers: googleAuthEnabled ? [Google] : [],
  session: {strategy: "jwt"},
  pages: {signIn: "/login", error: "/login"},
  callbacks: {
    jwt({token, account}) {
      if (account?.provider === "google") token.sub = account.providerAccountId;
      return token;
    },
    session({session, token}) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

export async function workspaceAccount() {
  if (!googleAuthEnabled) return null;
  const user = (await auth())?.user;
  return user?.id ? {id:user.id, name:user.name ?? "Google account", image:user.image} : null;
}
