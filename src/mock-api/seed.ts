// Fictional data only. Phone numbers use the reserved 555-01xx range.
import type { Customer, LinkedAccount, Loan } from "./types.js";

export const customers: Customer[] = [
  { id: "C1", name: "Maya Chen", phone: "+14155550101" },
  { id: "C2", name: "Jordan Reyes", phone: "+14155550102" },
  { id: "C3", name: "Sam Okafor", phone: "+14155550103" },
];

export const loans: Loan[] = [
  // Happy path: current, autopay off, two linked accounts.
  {
    id: "L1001",
    customerId: "C1",
    status: "current",
    principalBalanceCents: 842_000,
    payoffAmountCents: 845_300,
    nextPayment: { amountDueCents: 21_450, dueDate: "2026-11-14" },
    monthlyPaymentCents: 21_450,
    autopay: { enabled: false, linkedAccountId: null },
  },
  // Delinquent: two missed installments of $219.50 rolled into the amount due.
  {
    id: "L1002",
    customerId: "C2",
    status: "past_due",
    principalBalanceCents: 1_210_000,
    payoffAmountCents: 1_236_800,
    nextPayment: { amountDueCents: 43_900, dueDate: "2026-10-01" },
    monthlyPaymentCents: 21_950,
    autopay: { enabled: false, linkedAccountId: null },
  },
  // Paid off: no next payment, nothing to pay.
  {
    id: "L1003",
    customerId: "C3",
    status: "paid_off",
    principalBalanceCents: 0,
    payoffAmountCents: 0,
    nextPayment: null,
    monthlyPaymentCents: 0,
    autopay: { enabled: false, linkedAccountId: null },
  },
  // Same customer, second loan, autopay already on: forces "which loan?" disambiguation.
  {
    id: "L1004",
    customerId: "C3",
    status: "current",
    principalBalanceCents: 390_000,
    payoffAmountCents: 391_250,
    nextPayment: { amountDueCents: 15_820, dueDate: "2026-11-20" },
    monthlyPaymentCents: 15_820,
    autopay: { enabled: true, linkedAccountId: "A4" },
  },
];

export const linkedAccounts: LinkedAccount[] = [
  { id: "A1", customerId: "C1", bankName: "First Harbor Bank", last4: "4821" },
  { id: "A2", customerId: "C1", bankName: "Cedar Credit Union", last4: "0937" },
  { id: "A3", customerId: "C2", bankName: "First Harbor Bank", last4: "5512" },
  { id: "A4", customerId: "C3", bankName: "Lakeside Savings", last4: "7740" },
];
