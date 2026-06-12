import { expect } from "chai";
import _ from "lodash";
import "mocha";
import Utils from "../utils";
import RulesHarvester from "../../src";

/**
 * Regression tests for shared closure-parameter literals.
 *
 * rules-js binds closure parameters ONCE at corpus parse time, so an
 * object/array literal in the corpus (e.g. `value: []`) is a single shared
 * instance across every message processed. Before the cloneDeep removal,
 * every closure call deep-cloned its parameters, which hid this. These tests
 * ensure parameter literals are isolated per closure invocation so in-place
 * mutations (directly, or after being assigned into facts) cannot leak into
 * the parsed corpus and accumulate across runs.
 *
 * Mirrors the bug fixed in uni-ipb PR #459 (createFactsConst shared-array
 * rule duplication).
 */
describe("Closure parameter isolation", () => {
  // Sets a parameter value into facts WITHOUT cloning (like createFactsConst
  // pre-fix), then a later closure mutates that value in place via facts.
  const closures = [
    ...Utils.closures,
    {
      name: "setFactsValue",
      handler(facts: any, context: any) {
        _.set(facts, context.parameters.path, context.parameters.value);
        return facts;
      },
      options: { required: ["path", "value"] },
    },
    {
      name: "pushToFactsArray",
      handler(facts: any, context: any) {
        _.get(facts, context.parameters.path).push(context.parameters.item);
        return facts;
      },
      options: { required: ["path", "item"] },
    },
    {
      name: "captureParameter",
      handler(facts: any, context: any) {
        facts.captured = context.parameters.value;
        return facts;
      },
      options: { required: ["value"] },
    },
  ];

  async function runTwice(corpus: any[]) {
    const { config, rulesInputStub, rulesOutputStub } =
      Utils.generateRulesHarvesterConfig({ corpus, closures });
    const rulesHarvester = new RulesHarvester(config);
    rulesHarvester.start();
    const applyInput = rulesInputStub.registerInput.lastCall.args[0];

    const first = await applyInput({ event: { type: "test" } });
    const second = await applyInput({ event: { type: "test" } });
    return { first, second, rulesOutputStub };
  }

  it("array literal parameters do not accumulate mutations across runs", async () => {
    const corpus = [
      {
        name: "Shared array literal regression",
        rules: [
          {
            when: [{ closure: "isMatch", "event.type": "test" }],
            then: [
              // `value: []` is parsed once by rules-js; if the framework hands
              // the same instance to every run, the push below accumulates.
              { closure: "setFactsValue", path: "result.items", value: [] },
              {
                closure: "pushToFactsArray",
                path: "result.items",
                item: "ride-summary-rule",
              },
            ],
          },
        ],
      },
    ];

    const { first, second } = await runTwice(corpus);

    expect(first.result.items).to.deep.equal(["ride-summary-rule"]);
    expect(
      second.result.items,
      "second run saw mutations from the first run's shared parameter literal",
    ).to.deep.equal(["ride-summary-rule"]);
  });

  it("nested literals inside object parameters are isolated too", async () => {
    const corpus = [
      {
        name: "Nested literal regression",
        rules: [
          {
            when: [{ closure: "isMatch", "event.type": "test" }],
            then: [
              {
                closure: "setFactsValue",
                path: "result.summary",
                // The hazard applies at any depth, not just the top level
                value: { rides: [], meta: { count: 0 } },
              },
              {
                closure: "pushToFactsArray",
                path: "result.summary.rides",
                item: "ride-1",
              },
            ],
          },
        ],
      },
    ];

    const { first, second } = await runTwice(corpus);

    expect(first.result.summary.rides).to.deep.equal(["ride-1"]);
    expect(
      second.result.summary.rides,
      "nested array literal was shared across runs",
    ).to.deep.equal(["ride-1"]);
    expect(second.result.summary.meta).to.deep.equal({ count: 0 });
  });

  it("direct in-place mutation of a parameter does not leak into later runs", async () => {
    const mutatingClosures = [
      ...closures,
      {
        name: "mutateOwnParameter",
        handler(facts: any, context: any) {
          context.parameters.value.push("mutated");
          facts.seen = [...context.parameters.value];
          return facts;
        },
        options: { required: ["value"] },
      },
    ];
    const corpus = [
      {
        name: "Parameter self-mutation regression",
        rules: [
          {
            when: [{ closure: "isMatch", "event.type": "test" }],
            then: [{ closure: "mutateOwnParameter", value: [] }],
          },
        ],
      },
    ];

    const { config, rulesInputStub } = Utils.generateRulesHarvesterConfig({
      corpus,
      closures: mutatingClosures,
    });
    const rulesHarvester = new RulesHarvester(config);
    rulesHarvester.start();
    const applyInput = rulesInputStub.registerInput.lastCall.args[0];

    const first = await applyInput({ event: { type: "test" } });
    const second = await applyInput({ event: { type: "test" } });

    expect(first.seen).to.deep.equal(["mutated"]);
    expect(
      second.seen,
      "parameter mutation from the first run leaked into the second",
    ).to.deep.equal(["mutated"]);
  });

  it("dereferenced (^) parameters remain live references into facts, not clones", async () => {
    // Perf/behavior contract: only corpus literals are cloned. Values pulled
    // from facts via ^path must stay the same instance so closures can
    // observe/mutate facts through them and large facts are never deep-copied.
    const corpus = [
      {
        name: "Dereference stays by-reference",
        rules: [
          {
            when: [{ closure: "isMatch", "event.type": "test" }],
            then: [{ closure: "captureParameter", "^value": "payload" }],
          },
        ],
      },
    ];

    const { config, rulesInputStub } = Utils.generateRulesHarvesterConfig({
      corpus,
      closures,
    });
    const rulesHarvester = new RulesHarvester(config);
    rulesHarvester.start();
    const applyInput = rulesInputStub.registerInput.lastCall.args[0];

    const payload = { big: "object" };
    const result = await applyInput({ event: { type: "test" }, payload });

    expect(result.captured).to.equal(payload); // same instance, not a clone
  });
});
