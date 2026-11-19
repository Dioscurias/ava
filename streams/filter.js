// The CLI replaces this marker with the deployed program address.
function main(payload) {
  try {
    const program = "__ESCROW_PROGRAM_ID__";
    const batches = payload?.data ?? payload;
    if (!Array.isArray(batches)) return null;
    const matches = batches.flat().filter(transaction =>
      transaction?.success === true &&
      Array.isArray(transaction.programInvocations) &&
      transaction.programInvocations.some(invocation => invocation?.programId === program) &&
      typeof transaction.signature === "string" && Number.isSafeInteger(transaction.slot)
    ).map(({signature, slot, blockTime}) => ({signature, slot, blockTime: blockTime ?? null}));
    return matches.length ? matches : null;
  } catch {
    return null;
  }
}
