import { expect } from "chai";
import "mocha";
import Utils from "../utils";
import RulesHarvester, { CoreConditionals, closureGenerator } from "../../src";

describe("Rules Harvester benchmarks", () => {
  it("benchmarks 20 equal closure calls in when/then chain", async () => {
    const ruleCount = 50;
    const tryClosure = closureGenerator(
      "try",
      async (facts: any, context: any) => {
        const { try: tryFn, catch: catchFn } = context.parameters;
        try {
          return await tryFn.process(
            facts,
            context,
            // Object.assign(context, { parameters: {} }),
          );
        } catch (exception) {
          facts[context.parameters.exceptionKey || "exception"] = exception;
          await catchFn.process(
            facts,
            context,
            // Object.assign(context, { parameters: {} }),
          );

          return facts;
        }
      },
      { required: ["try", "catch"], closureParameters: ["try", "catch"] },
    );
    const corpus = [
      {
        name: "Benchmark 50 equal rules",
        rules: Array.from({ length: ruleCount }, (_unused, index) => ({
          when: [
            {
              closure: "try",
              try: {
                closure: "equal",
                "^value1": "path.in.facts",
                value2: "whatever test we want",
              },
              catch: { closure: "extendFacts", "result.tryFailed": true },
            },
          ],
          then: [
            {
              closure: "try",
              try: {
                closure: "extendFacts",
                [`result.benchMatched${index}`]: true,
              },
              catch: { closure: "extendFacts", "result.tryFailed": true },
            },
          ],
        })),
      },
    ];

    const extraClosures = Array.from({ length: 500 }, (_unused, index) => ({
      name: `benchNoop${index}`,
      handler(_facts: any, _context: any) {
        return true;
      },
    }));

    const { config, rulesInputStub, rulesOutputStub } =
      Utils.generateRulesHarvesterConfig({
        corpus,
        closures: [
          ...Utils.closures,
          ...CoreConditionals,
          tryClosure,
          ...extraClosures,
        ],
      });

    const rulesHarvester = new RulesHarvester(config);
    rulesHarvester.start();

    const applyInput = rulesInputStub.registerInput.lastCall.args[0];

    const facts = {
      path: { in: { facts: "whatever test we want" } },
    };

    const iterations = 500;
    const durationsMs: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await applyInput(facts, { runId: i });
      const end = process.hrtime.bigint();
      durationsMs.push(Number(end - start) / 1_000_000);
    }

    const averageMs =
      durationsMs.reduce((sum, value) => sum + value, 0) / iterations;

    console.log(
      `Average duration for ${iterations} runs with ${ruleCount} rules: ${averageMs.toFixed(
        3,
      )}ms`,
    );

    expect(rulesOutputStub.outputResult.callCount).to.equal(iterations);
    expect(
      rulesOutputStub.outputResult.lastCall.args[0].facts.result.benchMatched0,
    ).to.equal(true);
    expect(Number.isFinite(averageMs)).to.equal(true);
  });
});
