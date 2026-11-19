import type { Metadata } from "next";
import { DevnetWorkspace } from "../../../components/devnet-workspace";

export const metadata: Metadata = {title: "Solana Devnet"};

export default function Page() {
  return <DevnetWorkspace/>;
}
