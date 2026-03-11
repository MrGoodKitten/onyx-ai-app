// ONYX.AI 4 Rules Guard
// CreatedBy: ZEUS
// Protects proprietary rules & configs

export function assertRulesUsageAllowed(instanceId: string, createdBy: string) {
  if (createdBy !== "ZEUS") {
    throw new Error("Unauthorized rules usage: ONYX.AI rules are proprietary to ZEUS.");
  }

  // Optional: log or block specific instances here
  return true;
}
