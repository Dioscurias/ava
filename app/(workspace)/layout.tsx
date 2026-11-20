import {Workspace} from "../../components/workspace";
import {workspaceAccount} from "../../auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({children}: {children: React.ReactNode}) {
  const account = await workspaceAccount();
  return <Workspace key={account?.id ?? "guest"} account={account}>{children}</Workspace>;
}
