export type WhatsAppDeliveryStatus = "sent" | "delivered" | "read" | "failed";

const statusRank: Record<Exclude<WhatsAppDeliveryStatus, "failed">, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

/** Preserve the strongest known delivery state when callbacks arrive out of order. */
export function mergeWhatsAppDeliveryStatus(current: string | null | undefined, incoming: WhatsAppDeliveryStatus): WhatsAppDeliveryStatus {
  if (current === "failed") return "failed";
  if (current === "read") return "read";
  if (current === "delivered" && (incoming === "sent" || incoming === "failed")) return "delivered";
  if (current === "sent" && incoming === "failed") return "sent";
  if (current === "sent" || current === "delivered" || current === "read") {
    if (incoming === "failed") return current;
    return statusRank[incoming] > statusRank[current] ? incoming : current;
  }
  return incoming;
}

/** Only accept valid provider epoch timestamps that are not older than stored metadata. */
export function shouldAcceptDeliveryTimestamp(current: string, incoming: string): boolean {
  if (!/^\d{9,12}$/.test(incoming)) return false;
  const incomingSeconds = Number(incoming);
  if (!Number.isSafeInteger(incomingSeconds) || incomingSeconds <= 0) return false;
  if (!/^\d{9,12}$/.test(current)) return true;
  const currentSeconds = Number(current);
  if (!Number.isSafeInteger(currentSeconds) || currentSeconds <= 0) return true;
  return incomingSeconds >= currentSeconds;
}
