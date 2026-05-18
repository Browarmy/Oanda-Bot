import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  testOandaConnection,
  testDatabaseConnection,
  getDebugInfo,
  validateConfiguration,
  validateEquityCurveData,
  getSignalPerformance,
  explainPositionSizing,
  getDeploymentChecklist,
} from "./diagnostics";

export const diagnosticsRouter = router({
  testConnection: publicProcedure
    .input(
      z.object({
        token: z.string(),
        accountId: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await testOandaConnection(input.token, input.accountId);
    }),

  testDatabase: publicProcedure.query(async () => {
    return await testDatabaseConnection();
  }),

  getDebug: protectedProcedure.query(async ({ ctx }) => {
    return await getDebugInfo(ctx.user.id);
  }),

  validateConfig: publicProcedure
    .input(
      z.object({
        riskPerTrade: z.number().optional(),
        dailyLossGuard: z.number().optional(),
        confidenceThreshold: z.number().optional(),
        sessionFilter: z
          .array(
            z.object({
              name: z.string(),
              enabled: z.boolean(),
            })
          )
          .optional(),
      })
    )
    .query(({ input }) => {
      return validateConfiguration(input);
    }),

  validateEquityCurve: protectedProcedure.query(async ({ ctx }) => {
    return await validateEquityCurveData(ctx.user.id);
  }),

  getSignalPerformance: protectedProcedure.query(async ({ ctx }) => {
    return await getSignalPerformance(ctx.user.id);
  }),

  explainPositionSizing: publicProcedure
    .input(
      z.object({
        accountBalance: z.number(),
        riskPerTrade: z.number(),
      })
    )
    .query(({ input }) => {
      return explainPositionSizing(input.accountBalance, input.riskPerTrade);
    }),

  getDeploymentChecklist: publicProcedure
    .input(
      z.object({
        oandaTokenValid: z.boolean().optional(),
        oandaAccountIdValid: z.boolean().optional(),
        databaseConnected: z.boolean().optional(),
        githubRepoReady: z.boolean().optional(),
        railwayDeployed: z.boolean().optional(),
      })
    )
    .query(({ input }) => {
      return getDeploymentChecklist(input);
    }),
});
