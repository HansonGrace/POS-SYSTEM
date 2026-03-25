import { randomUUID } from "node:crypto";

const printJobs = [];
const MAX_PRINT_JOBS = 200;

function formatLine(label, value) {
  const safeLabel = label.padEnd(14, " ");
  return `${safeLabel}${value}`;
}

function buildReceiptText(order) {
  const lines = [
    "RANGEPOS RECEIPT",
    `ORDER #${order.id}`,
    `TIME ${new Date(order.createdAt).toISOString()}`,
    `CASHIER ${order.cashier.username}`,
    `PAYMENT ${order.paymentType}`,
    "----------------------------"
  ];

  for (const item of order.items) {
    lines.push(`${item.product.name} x${item.quantity}`);
    lines.push(formatLine("Line Total", `$${(item.lineTotalCents / 100).toFixed(2)}`));
  }

  lines.push("----------------------------");
  lines.push(formatLine("Subtotal", `$${(order.subtotalCents / 100).toFixed(2)}`));
  lines.push(formatLine("Tax", `$${(order.taxCents / 100).toFixed(2)}`));
  lines.push(formatLine("Total", `$${(order.totalCents / 100).toFixed(2)}`));
  lines.push("----------------------------");
  lines.push(order.status === "VOIDED" ? "STATUS: VOIDED" : "THANK YOU");

  return lines.join("\n");
}

export function createPrintJob(order, actorId, requestId) {
  const output = buildReceiptText(order);
  const printJob = {
    id: randomUUID(),
    orderId: order.id,
    actorId,
    requestId: requestId || null,
    output,
    createdAt: new Date().toISOString()
  };

  printJobs.unshift(printJob);
  if (printJobs.length > MAX_PRINT_JOBS) {
    printJobs.length = MAX_PRINT_JOBS;
  }

  return printJob;
}

export function listPrintJobs() {
  return [...printJobs];
}

export function resetPrintJobs() {
  printJobs.length = 0;
}
