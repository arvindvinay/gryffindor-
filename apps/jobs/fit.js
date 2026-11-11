/*
 * Matching engine for Job Radar.
 * Pure functions (no DOM, no network) so they can be unit-tested in Node.
 * Everything runs locally: the résumé text never leaves the browser.
 */
(function (root) {
  "use strict";

  /* Canonical skill -> aliases (lower-case). Kept deliberately explicit:
   * ambiguous short words like "go", "r" or "c" are only matched in safe forms. */
  var SKILLS = {
    // Languages
    "JavaScript": ["javascript", "js", "ecmascript", "es6"],
    "TypeScript": ["typescript", "ts"],
    "Python": ["python"],
    "Java": ["java"],
    "Kotlin": ["kotlin"],
    "Swift": ["swift"],
    "Objective-C": ["objective-c", "objective c"],
    "C#": ["c#", "csharp"],
    "C++": ["c++", "cpp"],
    "Go": ["golang", "go developer", "go engineer", "go lang"],
    "Rust": ["rust"],
    "Ruby": ["ruby"],
    "PHP": ["php"],
    "Scala": ["scala"],
    "Elixir": ["elixir"],
    "Dart": ["dart"],
    "R": ["r programming", "rstudio", "tidyverse"],
    "SQL": ["sql"],
    "Bash": ["bash", "shell scripting"],
    // Frontend
    "React": ["react", "react.js", "reactjs"],
    "React Native": ["react native"],
    "Next.js": ["next.js", "nextjs"],
    "Vue": ["vue", "vue.js", "vuejs", "nuxt"],
    "Angular": ["angular", "angularjs"],
    "Svelte": ["svelte", "sveltekit"],
    "HTML/CSS": ["html", "css", "html5", "css3", "sass", "scss"],
    "Tailwind": ["tailwind", "tailwindcss"],
    "Flutter": ["flutter"],
    "Redux": ["redux"],
    // Backend & frameworks
    "Node.js": ["node.js", "nodejs", "node"],
    "Express": ["express.js", "expressjs"],
    "Django": ["django"],
    "Flask": ["flask"],
    "FastAPI": ["fastapi"],
    "Spring": ["spring boot", "spring framework", "springboot"],
    "Rails": ["rails", "ruby on rails"],
    "Laravel": ["laravel"],
    ".NET": [".net", "dotnet", "asp.net"],
    "GraphQL": ["graphql"],
    "REST APIs": ["rest api", "rest apis", "restful"],
    "Microservices": ["microservices", "microservice"],
    // Data & ML
    "PostgreSQL": ["postgresql", "postgres"],
    "MySQL": ["mysql", "mariadb"],
    "MongoDB": ["mongodb", "mongo"],
    "Redis": ["redis"],
    "Elasticsearch": ["elasticsearch", "opensearch"],
    "Kafka": ["kafka"],
    "Spark": ["spark", "pyspark"],
    "Airflow": ["airflow"],
    "dbt": ["dbt"],
    "Snowflake": ["snowflake"],
    "BigQuery": ["bigquery"],
    "Pandas": ["pandas"],
    "NumPy": ["numpy"],
    "Machine Learning": ["machine learning", "ml engineer", "ml"],
    "Deep Learning": ["deep learning"],
    "PyTorch": ["pytorch"],
    "TensorFlow": ["tensorflow", "keras"],
    "LLMs": ["llm", "llms", "large language model", "large language models", "genai", "generative ai", "prompt engineering", "rag"],
    "NLP": ["nlp", "natural language processing"],
    "Computer Vision": ["computer vision", "opencv"],
    "Data Analysis": ["data analysis", "data analytics", "data analyst"],
    "Statistics": ["statistics", "statistical"],
    "Excel": ["microsoft excel", "ms excel", "advanced excel", "excel skills", "spreadsheets", "google sheets", "vlookup", "pivot tables"],
    "Power BI": ["power bi", "powerbi"],
    "Tableau": ["tableau"],
    "Looker": ["looker"],
    // Cloud & DevOps
    "AWS": ["aws", "amazon web services"],
    "GCP": ["gcp", "google cloud"],
    "Azure": ["azure"],
    "Docker": ["docker", "containers"],
    "Kubernetes": ["kubernetes", "k8s"],
    "Terraform": ["terraform"],
    "CI/CD": ["ci/cd", "ci cd", "github actions", "gitlab ci", "jenkins", "circleci"],
    "Linux": ["linux", "unix"],
    "Git": ["git", "github", "gitlab"],
    "Observability": ["prometheus", "grafana", "datadog", "observability"],
    "Security": ["security", "owasp", "penetration testing", "pentest", "soc 2", "iso 27001"],
    // Testing & practice
    "Testing": ["unit testing", "test automation", "jest", "pytest", "cypress", "playwright", "selenium", "tdd"],
    "Agile": ["agile", "scrum", "kanban"],
    "System Design": ["system design", "distributed systems", "scalability"],
    // Product, design, business
    "Product Management": ["product management", "product manager", "roadmap", "product owner"],
    "UX/UI Design": ["ux", "ui design", "ux design", "user experience", "user research", "ui/ux", "ux/ui"],
    "Figma": ["figma"],
    "Adobe Creative Suite": ["photoshop", "illustrator", "adobe xd", "indesign", "after effects", "premiere pro"],
    "SEO": ["seo", "search engine optimization"],
    "Content Writing": ["content writing", "copywriting", "copywriter", "content marketing", "technical writing"],
    "Digital Marketing": ["digital marketing", "performance marketing", "google ads", "facebook ads", "paid social", "sem", "ppc"],
    "Social Media": ["social media"],
    "Email Marketing": ["email marketing", "mailchimp", "klaviyo"],
    "Sales": ["sales", "business development", "account executive", "lead generation"],
    "CRM": ["crm", "salesforce", "hubspot"],
    "Customer Support": ["customer support", "customer service", "zendesk", "intercom", "helpdesk"],
    "Customer Success": ["customer success", "account management"],
    "Project Management": ["project management", "project manager", "jira", "asana", "pmp"],
    "Finance": ["accounting", "bookkeeping", "financial analysis", "financial modelling", "financial modeling", "quickbooks"],
    "Recruiting": ["recruiting", "recruitment", "talent acquisition", "sourcing"],
    "Communication": ["communication skills", "stakeholder management", "presentation skills"],
    // Languages (human)
    "English": ["english", "fluent english"],
    "German": ["german", "deutsch"],
    "French": ["french"],
    "Spanish": ["spanish"]
  };

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Pre-compile one regex per skill. Boundaries treat letters, digits, + and # (and a
  // leading dot) as "word" characters, so "java" doesn't match "javascript" and the
  // "js" in "next.js" isn't counted as JavaScript.
  var MATCHERS = Object.keys(SKILLS).map(function (name) {
    var alts = SKILLS[name].map(escapeRe).join("|");
    return { name: name, re: new RegExp("(^|[^a-z0-9+#.])(?:" + alts + ")(?![a-z0-9+#]|\\.[a-z0-9])", "i") };
  });

  function stripHtml(html) {
    return String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  }

  function extractSkills(text) {
    var t = String(text || "").toLowerCase();
    var found = [];
    MATCHERS.forEach(function (m) { if (m.re.test(t)) found.push(m.name); });
    return found;
  }

  /* Score how well a résumé fits a job.
   * resumeSkills: array of canonical skill names
   * job: { title, tags:[], description }
   * opts: { roles: ["frontend", "react developer"] }
   * Returns { score (0–100 or null), matched:[], missing:[], jobSkills:[] } */
  function fit(resumeSkills, job, opts) {
    opts = opts || {};
    var have = {};
    (resumeSkills || []).forEach(function (s) { have[s] = true; });

    var headline = (job.title || "") + " " + (job.tags || []).join(" ");
    var strong = extractSkills(headline);             // skills in title/tags matter more
    var all = extractSkills(headline + " " + (job.description || ""));
    var strongSet = {};
    strong.forEach(function (s) { strongSet[s] = true; });

    // Spoken languages only count if they're in the title/tags; descriptions
    // mention "English" or "German" too casually to be a requirement signal.
    var HUMAN = { English: 1, German: 1, French: 1, Spanish: 1 };
    var jobSkills = all.filter(function (s) { return !HUMAN[s] || strongSet[s]; });

    var total = 0, got = 0, matched = [], missing = [];
    jobSkills.forEach(function (s) {
      var w = strongSet[s] ? 2 : 1;
      total += w;
      if (have[s]) { got += w; matched.push(s); } else { missing.push(s); }
    });

    // Most important missing skills first (title/tag skills before description-only ones).
    missing.sort(function (a, b) { return (strongSet[b] ? 1 : 0) - (strongSet[a] ? 1 : 0); });

    var roleHit = roleMatch(job.title, opts.roles);
    var score;
    if (!total) {
      score = roleHit ? 60 : null; // no recognisable skills: only judge on title
    } else {
      // Square-root curve: matching 4 of 9 skills is a decent fit, not a 44% "fail".
      score = Math.round(100 * Math.sqrt(got / total));
      // The role bonus can lift a score, but only a job where you have every skill gets 100%.
      if (roleHit) score = Math.min(missing.length ? 95 : 100, score + 15);
      else if (opts.roles && opts.roles.length) score = Math.max(0, score - 10);
    }

    return { score: score, matched: matched, missing: missing, jobSkills: jobSkills, roleMatch: roleHit };
  }

  function roleMatch(title, roles) {
    if (!roles || !roles.length || !title) return false;
    var t = String(title).toLowerCase();
    return roles.some(function (r) {
      var words = String(r).toLowerCase().split(/\s+/).filter(Boolean);
      return words.length > 0 && words.every(function (w) { return t.indexOf(w) !== -1; });
    });
  }

  function parseRoles(input) {
    return String(input || "").split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* Rank jobs and summarise the skills most often missing among good matches. */
  function rank(jobs, resumeSkills, opts) {
    var scored = jobs.map(function (j) {
      var f = fit(resumeSkills, j, opts);
      return Object.assign({}, j, { fit: f });
    });
    scored.sort(function (a, b) {
      var sa = a.fit.score === null ? -1 : a.fit.score;
      var sb = b.fit.score === null ? -1 : b.fit.score;
      if (sb !== sa) return sb - sa;
      return (b.postedAt || 0) - (a.postedAt || 0);
    });
    return scored;
  }

  function skillGaps(rankedJobs, limit) {
    var counts = {};
    var considered = rankedJobs.filter(function (j) { return j.fit.score !== null && j.fit.score >= 40; }).slice(0, 40);
    considered.forEach(function (j) {
      j.fit.missing.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    });
    return Object.keys(counts)
      .map(function (s) { return { skill: s, jobs: counts[s] }; })
      .sort(function (a, b) { return b.jobs - a.jobs || a.skill.localeCompare(b.skill); })
      .slice(0, limit || 8);
  }

  /* ----- normalise API responses into one job shape ----- */

  // https://www.arbeitnow.com/api/job-board-api
  function fromArbeitnow(data) {
    return ((data && data.data) || []).map(function (j) {
      return {
        id: "arbeitnow:" + j.slug,
        source: "Arbeitnow",
        title: j.title,
        company: j.company_name,
        location: j.location || "",
        remote: !!j.remote,
        tags: (j.tags || []).concat(j.job_types || []),
        description: stripHtml(j.description),
        url: j.url,
        postedAt: j.created_at ? j.created_at * 1000 : null,
        salary: null
      };
    });
  }

  // https://remoteok.com/api — the first element is a legal/terms notice, not a job.
  function fromRemoteOK(data) {
    return (Array.isArray(data) ? data : []).filter(function (j) { return j && j.id && j.position; }).map(function (j) {
      var salary = null;
      if (j.salary_min && j.salary_max) salary = "$" + Math.round(j.salary_min / 1000) + "k–$" + Math.round(j.salary_max / 1000) + "k";
      return {
        id: "remoteok:" + j.id,
        source: "Remote OK",
        title: j.position,
        company: j.company,
        location: j.location || "Remote",
        remote: true,
        tags: j.tags || [],
        description: stripHtml(j.description),
        url: j.url || j.apply_url,
        postedAt: j.epoch ? j.epoch * 1000 : (j.date ? Date.parse(j.date) : null),
        salary: salary
      };
    });
  }

  function dedupe(jobs) {
    var seen = {};
    return jobs.filter(function (j) {
      var k = (String(j.title) + "|" + String(j.company)).toLowerCase().replace(/\s+/g, " ");
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  var api = {
    SKILLS: SKILLS,
    stripHtml: stripHtml,
    extractSkills: extractSkills,
    fit: fit,
    roleMatch: roleMatch,
    parseRoles: parseRoles,
    rank: rank,
    skillGaps: skillGaps,
    fromArbeitnow: fromArbeitnow,
    fromRemoteOK: fromRemoteOK,
    dedupe: dedupe
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Fit = api;
})(this);
