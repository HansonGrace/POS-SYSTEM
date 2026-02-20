import { emitSecurityEvent } from "../security/events.js";

export async function writeAuditLog(_db, { action, metadata = null }, req = null) {
  await emitSecurityEvent(action, metadata || {}, req);
}
