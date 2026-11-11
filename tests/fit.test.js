const test = require("node:test");
const assert = require("node:assert/strict");
const Fit = require("../apps/jobs/fit.js");

test("extractSkills respects word boundaries", () => {
  const s = Fit.extractSkills("Senior JavaScript dev. Node.js, React, C++ and C#. Some Java.");
  for (const k of ["JavaScript", "Node.js", "React", "C++", "C#", "Java"]) assert.ok(s.includes(k), k);
  assert.ok(!Fit.extractSkills("We use JavaScript").includes("Java"), "java must not match javascript");
  assert.ok(!Fit.extractSkills("reactive programming").includes("React"));
  assert.ok(!Fit.extractSkills("You will excel at the rest of the work").includes("Excel"));
  assert.ok(!Fit.extractSkills("Let's go to the office").includes("Go"));
  assert.ok(Fit.extractSkills("Backend in Golang").includes("Go"));
});

test("fit: matched, missing and score", () => {
  const job = { title: "Frontend Engineer (React, TypeScript)", tags: ["react"], description: "Next.js, Jest, GraphQL and AWS." };
  const f = Fit.fit(["React", "TypeScript", "Next.js", "Testing"], job);
  assert.deepEqual(f.matched.sort(), ["Next.js", "React", "Testing", "TypeScript"].sort());
  assert.deepEqual(f.missing.sort(), ["AWS", "GraphQL"]);
  assert.ok(f.score >= 75 && f.score <= 100, "score " + f.score);
});

test("fit: role keywords boost or penalise", () => {
  const job = { title: "React Developer", tags: [], description: "React and CSS" };
  const base = Fit.fit(["React"], job).score;
  assert.ok(Fit.fit(["React"], job, { roles: ["react developer"] }).score > base);
  assert.ok(Fit.fit(["React"], job, { roles: ["data scientist"] }).score < base);
});

test("fit: no recognisable skills gives null unless the title matches", () => {
  const job = { title: "Barista", tags: [], description: "Make great coffee" };
  assert.equal(Fit.fit(["React"], job).score, null);
  assert.equal(Fit.fit([], job, { roles: ["barista"] }).score, 60);
});

test("rank sorts by score then recency; skillGaps counts missing skills", () => {
  const jobs = [
    { id: "a", title: "Python Dev", tags: [], description: "Python, Django, AWS", postedAt: 1 },
    { id: "b", title: "Python Dev", tags: [], description: "Python, Django, Docker", postedAt: 2 },
    { id: "c", title: "Rust Dev", tags: [], description: "Rust", postedAt: 3 }
  ];
  const r = Fit.rank(jobs, ["Python", "Django"]);
  assert.deepEqual(r.map((j) => j.id), ["b", "a", "c"]);
  const gaps = Fit.skillGaps(r);
  assert.ok(gaps.some((g) => g.skill === "AWS" && g.jobs === 1));
  assert.ok(gaps.some((g) => g.skill === "Docker" && g.jobs === 1));
});

test("normalisers handle real API shapes", () => {
  const an = Fit.fromArbeitnow({ data: [{ slug: "x", title: "Dev", company_name: "Co", description: "<p>React &amp; Node</p>", remote: true, url: "https://a", tags: ["IT"], job_types: ["full time"], location: "Berlin", created_at: 1700000000 }] });
  assert.equal(an[0].id, "arbeitnow:x");
  assert.equal(an[0].description, "React & Node");
  assert.equal(an[0].postedAt, 1700000000000);
  const ro = Fit.fromRemoteOK([{ legal: "terms" }, { id: "9", position: "SRE", company: "Z", tags: ["aws"], description: "k8s", url: "https://r", epoch: 1700000000, salary_min: 90000, salary_max: 120000 }]);
  assert.equal(ro.length, 1, "legal notice entry is skipped");
  assert.equal(ro[0].salary, "$90k–$120k");
  assert.equal(Fit.dedupe([an[0], Object.assign({}, an[0], { id: "dup" })]).length, 1);
});

test("role bonus never reaches 100% while a skill is missing", () => {
  const job = { title: "React Developer", tags: [], description: "React, TypeScript, GraphQL" };
  assert.equal(Fit.fit(["React", "TypeScript"], job, { roles: ["react"] }).score, 95);
  assert.equal(Fit.fit(["React", "TypeScript", "GraphQL"], job, { roles: ["react"] }).score, 100);
  assert.ok(!Fit.extractSkills("Next.js").includes("JavaScript"));
});
