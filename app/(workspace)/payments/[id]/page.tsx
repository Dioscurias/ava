import {TimedPaymentDetail} from "../../../../components/timed-payment-detail";
import {JudgeReceiptDetail} from "../../../../components/judge-devnet";
import {PaymentDetail} from "../../../../components/payment-detail";
export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (/^SOL-[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) return <TimedPaymentDetail address={id.slice(4)}/>;
  return /^DV-[0-9a-f]{32}$/.test(id) ? <JudgeReceiptDetail requestId={id.slice(3)}/> : <PaymentDetail id={id}/>;
}
