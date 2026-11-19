import type {Metadata} from "next";
import {Agent} from "../../../components/agent";
export const metadata: Metadata = {title: "Agent"};
export default async function Page({searchParams}: {searchParams: Promise<{demo?: string}>}) {
  return <Agent intro demo={(await searchParams).demo === "1"}/>;
}
