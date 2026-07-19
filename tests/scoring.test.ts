import { describe, expect, it } from "vitest";
import { issue, sortIssues } from "../src/core/issue.js";
import { scoreIssues } from "../src/core/scoring.js";

const issues = [
  issue({ id: "b", category: "content", severity: "low", title: "B", description: "B", recommendation: "Fix B" }),
  issue({ id: "a", category: "technical", severity: "critical", title: "A", description: "A", recommendation: "Fix A" }),
  issue({ id: "c", category: "schema", severity: "medium", title: "C", description: "C", recommendation: "Fix C" })
];

describe("scoring", () => {
  it("is stable and severity based", () => {
    const one = scoreIssues(issues, ["technical", "content", "schema"]);
    const two = scoreIssues([...issues].reverse(), ["schema", "content", "technical"]);
    expect(one).toEqual(two);
    expect(one.categories.technical).toBe(75);
    expect(one.categories.content).toBe(97);
    expect(one.categories.schema).toBe(92);
  });

  it("sorts issues deterministically", () => {
    expect(sortIssues(issues).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});
