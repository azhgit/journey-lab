import { GraphQLError } from "graphql";
import { createSchema, createYoga } from "graphql-yoga";
import type { Store } from "./store.js";
import type { ScenarioFlag } from "./types.js";
import { loanView, type LoanView } from "./views.js";

export type GraphQLContext = { flags: ReadonlySet<ScenarioFlag> };

const typeDefs = /* GraphQL */ `
  type Loan {
    id: ID!
    status: LoanStatus!
    principalBalanceCents: Int!
    payoffAmountCents: Int!
    nextPayment: NextPayment
    autopay: Autopay!
    customer: Customer!
  }
  type Customer { id: ID! phone: String! }
  type NextPayment { amountDueCents: Int! dueDate: String! }
  type Autopay { enabled: Boolean! linkedAccount: LinkedAccount }
  type LinkedAccount { id: ID! bankName: String! last4: String! }
  enum LoanStatus { CURRENT PAST_DUE PAID_OFF }
  type Query { loanDetails(id: ID!): Loan }
`;

const STATUS = { current: "CURRENT", past_due: "PAST_DUE", paid_off: "PAID_OFF" } as const;

export function createGraphQL(store: Store) {
  return createYoga<GraphQLContext>({
    schema: createSchema<GraphQLContext>({
      typeDefs,
      resolvers: {
        Query: {
          // Real GraphQL: a missing loan is HTTP 200, data.loanDetails = null, plus an errors entry.
          loanDetails: (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
            const loan = store.loans.get(args.id);
            if (!loan) throw new GraphQLError("Loan not found", { extensions: { code: "NOT_FOUND" } });
            return loanView(store, loan, ctx.flags);
          },
        },
        Loan: {
          status: (loan: LoanView) => STATUS[loan.status],
          // Nullable field failing on its own: partial data with an error at ["loanDetails", "nextPayment"].
          nextPayment: (loan: LoanView, _: unknown, ctx: GraphQLContext) => {
            if (ctx.flags.has("graphql_partial_error")) {
              throw new GraphQLError("Payment schedule service unavailable", {
                extensions: { code: "UPSTREAM_UNAVAILABLE" },
              });
            }
            return loan.nextPayment;
          },
          autopay: (loan: LoanView) => {
            const id = loan.autopay.linkedAccountId;
            const account = id ? store.accounts.get(id) : undefined;
            return {
              enabled: loan.autopay.enabled,
              linkedAccount: account ? { id: account.id, bankName: account.bankName, last4: account.last4 } : null,
            };
          },
        },
      },
    }),
    graphqlEndpoint: "/graphql",
    logging: false,
    landingPage: false,
  });
}
