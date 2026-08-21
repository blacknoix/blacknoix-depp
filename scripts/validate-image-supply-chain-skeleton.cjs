#!/usr/bin/env node
/**
 * Offline validator for the staging image supply-chain workflow skeleton.
 * Does not contact GitHub, AWS, Docker, Kubernetes, or the internet.
 *
 * Exit 0: safety OK + INTENTIONALLY NON-OPERATIONAL
 * Exit 1: safety violation
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "staging-image-supply-chain.yml",
);
const RUNBOOK = path.join(
  ROOT,
  "docs",
  "runbooks",
  "aws-github-oidc-image-supply-chain.md",
);

function fail(msg) {
  console.error(`image-supply-chain-skeleton FAIL: ${msg}`);
  process.exit(1);
}

function mustInclude(text, snippet, label) {
  if (!text.includes(snippet)) {
    fail(`missing required ${label}: ${snippet}`);
  }
}

function mustMatch(text, re, label) {
  if (!re.test(text)) {
    fail(`missing required ${label}`);
  }
}

function mustNotMatch(text, re, label) {
  if (re.test(text)) {
    fail(`forbidden ${label}`);
  }
}

function main() {
  if (!fs.existsSync(WORKFLOW)) {
    fail("workflow file missing");
  }
  if (!fs.existsSync(RUNBOOK)) {
    fail("runbook missing");
  }

  const wf = fs.readFileSync(WORKFLOW, "utf8");
  const rb = fs.readFileSync(RUNBOOK, "utf8");

  // Optional YAML parse if dependency happens to exist (not required).
  let yamlParsed = false;
  try {
    const yamlPath = require.resolve("yaml", {
      paths: [
        path.join(ROOT, "backend", "api-gateway", "node_modules"),
        path.join(ROOT, "node_modules"),
      ],
    });
    const YAML = require(yamlPath);
    YAML.parse(wf);
    yamlParsed = true;
    console.log("image-supply-chain-skeleton: YAML parse ok (local yaml module)");
  } catch {
    console.log(
      "image-supply-chain-skeleton: full YAML parsing unavailable — using static checks",
    );
  }

  mustInclude(wf, "workflow_dispatch", "workflow_dispatch trigger");
  mustInclude(wf, "REPLACE_WITH_FOUNDER_APPROVAL", "founder approval placeholder default");
  mustInclude(wf, "REPLACE_WITH_EXECUTE_CONFIRM", "execute confirm placeholder default");
  mustInclude(wf, "REPLACE_WITH_AWS_ROLE_ARN", "AWS role placeholder default");
  mustInclude(wf, "REPLACE_WITH_ECR_REPOSITORY_URI", "ECR URI placeholder default");
  mustInclude(wf, "non-operational-guard", "guard job");
  mustInclude(wf, "before AWS auth", "guard-before-auth messaging");
  mustInclude(wf, "configure-aws-credentials", "OIDC AWS auth step");
  mustInclude(wf, "needs: non-operational-guard", "cloud job depends on guard");

  // Protected GitHub Environment binding (cloud job only)
  function extractJobBody(text, jobId) {
    const header = new RegExp(`^ {2}${jobId}:\\r?\\n`, "m");
    const match = header.exec(text);
    if (!match) {
      return null;
    }
    const afterHeader = match.index + match[0].length;
    const rest = text.slice(afterHeader);
    const nextJob = rest.search(/^ {2}[a-zA-Z0-9_-]+:/m);
    return nextJob < 0 ? rest : rest.slice(0, nextJob);
  }

  const guardJob = extractJobBody(wf, "non-operational-guard");
  const supplyJob = extractJobBody(wf, "supply-chain");
  if (!guardJob) {
    fail("could not locate non-operational-guard job block");
  }
  if (!supplyJob) {
    fail("could not locate supply-chain job block");
  }

  if (/^ {4}environment:\s*/m.test(guardJob)) {
    fail("non-operational-guard must not declare environment:");
  }
  const jobLevelEnv = supplyJob.match(/^ {4}environment:\s*staging\s*$/gm) || [];
  if (jobLevelEnv.length !== 1) {
    fail("supply-chain job must declare exactly one job-level environment: staging");
  }
  if (/^ {6,}environment:\s*/m.test(supplyJob)) {
    fail("environment: must not be placed under a step (indent deeper than job level)");
  }
  if (/configure-aws-credentials/.test(guardJob)) {
    fail("OIDC configure-aws-credentials must not appear in non-operational-guard");
  }
  if (!/configure-aws-credentials/.test(supplyJob)) {
    fail("OIDC configure-aws-credentials must appear inside supply-chain");
  }
  const oidcOccurrences = (wf.match(/configure-aws-credentials/g) || []).length;
  if (oidcOccurrences !== 1) {
    fail("configure-aws-credentials must appear exactly once (inside supply-chain)");
  }

  mustNotMatch(wf, /^\s*push:\s*$/m, "active push trigger");
  mustNotMatch(wf, /pull_request_target/, "pull_request_target");
  mustNotMatch(wf, /:latest\b/, "latest tag");
  mustNotMatch(wf, /AKIA[0-9A-Z]{16}/, "AWS access key id");
  mustNotMatch(wf, /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/, "private key");
  mustNotMatch(wf, /arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_-]+/, "concrete IAM role ARN");
  mustNotMatch(wf, /postgres:\/\/[^\s]+/i, "postgres URL");
  mustNotMatch(wf, /dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9._/-]+/i, "concrete ECR repository URI");

  // Permissions: contents read; no write-all
  mustMatch(wf, /permissions:\s*\n(?:[ \t]+.+\n)*?[ \t]+contents:\s*read/, "contents: read");
  mustInclude(wf, "id-token: write", "id-token write for OIDC/cosign");
  mustNotMatch(wf, /permissions:\s*write-all/, "write-all permissions");

  // Dockerfile / build context discovery
  mustInclude(wf, "backend/api-gateway/Dockerfile", "Dockerfile path");
  mustInclude(wf, "backend/api-gateway", "build context");

  // Quality gates
  for (const cmd of [
    "npm ci",
    "npm run typecheck",
    "npm run typecheck:test",
    "npm run test:unit",
  ]) {
    mustInclude(wf, cmd, cmd);
  }
  mustInclude(wf, "test:db skipped", "test:db skip until fixture");

  // Scan policy + exception fail-closed
  mustInclude(wf, "trivy", "trivy");
  const TRIVY_SHA = "57a97c7e7821a5776cebc9bb87c984fa69cba8f1";
  const TRIVY_PIN = `aquasecurity/trivy-action@${TRIVY_SHA}`;
  mustInclude(wf, TRIVY_PIN, "immutable trivy-action commit pin");
  mustNotMatch(wf, /aquasecurity\/trivy-action@0\.28\.0\b/, "unresolvable trivy-action 0.28.0");
  mustNotMatch(wf, /aquasecurity\/trivy-action@(latest|main|master)\b/, "floating trivy-action ref");
  mustNotMatch(
    wf,
    /aquasecurity\/trivy-action@v?\d+\.\d+\.\d+\b/,
    "mutable trivy-action version tag (require commit SHA pin)",
  );
  const trivyRefs = [...wf.matchAll(/aquasecurity\/trivy-action@([^\s#"']+)/g)].map(
    (m) => m[1],
  );
  if (trivyRefs.length !== 1) {
    fail(
      `trivy-action must appear exactly once with the reviewed pin (found ${trivyRefs.length})`,
    );
  }
  if (trivyRefs[0] !== TRIVY_SHA) {
    fail(`trivy-action must pin exactly ${TRIVY_SHA} (found ${trivyRefs[0]})`);
  }
  if (!/^[0-9a-f]{40}$/i.test(trivyRefs[0])) {
    fail("trivy-action pin must be a full 40-character commit SHA");
  }

  // Every third-party action must be pinned to a full 40-char commit SHA.
  const actionRefs = [...wf.matchAll(/^\s+uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
  if (actionRefs.length === 0) {
    fail("expected at least one uses: action reference");
  }
  for (const ref of actionRefs) {
    if (ref.startsWith("./") || ref.startsWith("docker://")) {
      continue;
    }
    const at = ref.lastIndexOf("@");
    if (at < 0) {
      fail(`action missing @ref: ${ref}`);
    }
    const pin = ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/i.test(pin)) {
      fail(
        `mutable third-party action reference rejected (require full 40-char SHA): ${ref}`,
      );
    }
  }
  mustInclude(
    wf,
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "immutable upload-artifact commit pin",
  );

  const iTrivy = wf.indexOf(TRIVY_PIN);
  const iUploadEvidence = wf.indexOf("Upload Trivy scan evidence");
  const iPolicy = wf.indexOf("Enforce scan policy");
  const iPush = wf.indexOf("docker push");
  if (iTrivy < 0 || iUploadEvidence < 0 || iPolicy < 0 || iPush < 0) {
    fail(
      "missing Trivy step, Trivy evidence upload, policy gate, or docker push for order checks",
    );
  }
  if (!(iTrivy < iUploadEvidence && iUploadEvidence < iPolicy && iPolicy < iPush)) {
    fail(
      "order must be Trivy scan -> Trivy evidence upload -> policy gate -> ECR push",
    );
  }
  mustInclude(wf, 'exit-code: "0"', "trivy exit-code 0 for retained JSON");
  mustInclude(wf, "if: always()", "evidence upload runs even when later steps fail");
  mustInclude(wf, "if-no-files-found: error", "fail closed when trivy JSON missing");
  mustInclude(
    wf,
    "scripts/evaluate-trivy-image-policy.cjs",
    "local Node policy evaluator",
  );
  mustNotMatch(
    wf,
    /Enforce scan policy[\s\S]{0,400}continue-on-error:\s*true/,
    "policy continue-on-error",
  );
  mustInclude(wf, "CRITICAL", "critical severity");
  mustInclude(wf, "HIGH", "high severity");
  mustInclude(wf, "FOUNDER_ACK_HIGH_EXCEPTION", "founder exception ack");
  mustInclude(wf, "high-vuln-exception-record", "exception artifact");
  const policyEvalPath = path.join(ROOT, "scripts", "evaluate-trivy-image-policy.cjs");
  if (!fs.existsSync(policyEvalPath)) {
    fail("missing scripts/evaluate-trivy-image-policy.cjs");
  }
  const policyEval = fs.readFileSync(policyEvalPath, "utf8");
  mustInclude(policyEval, "BLOCK:", "fail-closed block messaging in policy evaluator");
  mustInclude(policyEval, "HIGH_EXC", "HIGH_EXC reporting in policy evaluator");
  mustInclude(
    policyEval,
    "blocking_critical_with_fix",
    "critical blocking count in policy evaluator",
  );

  // SBOM / cosign / digest deployment rule
  mustInclude(wf, "cyclonedx", "cyclonedx sbom");
  mustInclude(wf, "cosign sign", "cosign keyless sign");
  mustInclude(wf, "sha256", "digest");
  mustInclude(wf, "Deploy ONLY:", "digest-only deploy messaging");
  mustInclude(wf, "attest-build-provenance", "provenance attestation");

  // No cluster / IaC provisioning commands as executable steps
  mustNotMatch(wf, /^\s*run:[\s\S]{0,80}\bkubectl\b/m, "kubectl execution");
  mustNotMatch(wf, /^\s*run:[\s\S]{0,80}\bhelm\b/m, "helm execution");
  mustNotMatch(wf, /^\s*run:[\s\S]{0,80}\bargocd\b/m, "argocd execution");
  mustNotMatch(wf, /\bterraform\b/i, "terraform");
  mustNotMatch(wf, /\bpulumi\b/i, "pulumi");
  mustNotMatch(wf, /\bcloudformation\b/i, "cloudformation");
  mustNotMatch(wf, /\baws\s+ec2\b/i, "aws ec2 provisioning");
  mustNotMatch(wf, /\baws\s+eks\b/i, "aws eks provisioning");

  // Runbook
  mustInclude(rb, "INTENTIONALLY NON-OPERATIONAL", "runbook non-operational banner");
  mustInclude(rb, "<AWS_ACCOUNT_ID>", "trust policy placeholder");
  mustInclude(rb, "sts.amazonaws.com", "aud restriction");
  mustInclude(rb, "180 days", "retention");
  mustInclude(rb, "REPLACE_WITH_ECR_IMAGE_AT_DIGEST", "gitops placeholder linkage");
  mustInclude(
    rb,
    "repo:blacknoix/blacknoix-depp:environment:staging",
    "OIDC environment trust subject",
  );
  mustInclude(rb, "environment: staging", "runbook environment binding");
  mustInclude(rb, "Environment approval is a CI gate only", "environment approval non-claim");
  mustInclude(
    rb,
    "aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1",
    "runbook trivy immutable pin",
  );
  mustInclude(rb, "32265431591", "failed run ID record");
  mustInclude(rb, "Pre-execution external-action resolution", "failure class non-claim");
  mustInclude(
    rb,
    "log-observed, artifact not retained",
    "historic evidence-gap classification",
  );
  mustInclude(
    rb,
    "new controlled manual run is required",
    "remediation requires new run",
  );

  console.log("");
  console.log("image-supply-chain-skeleton: safety checks PASSED");
  console.log(
    "image-supply-chain-skeleton: INTENTIONALLY NON-OPERATIONAL — defaults are REPLACE_* and guard fails before AWS auth",
  );
  if (!yamlParsed) {
    console.log(
      "image-supply-chain-skeleton: note — install/use a YAML parser locally if you need AST validation beyond static checks",
    );
  }
  console.log(
    "image-supply-chain-skeleton: no GitHub/AWS/Docker/Kubernetes/network calls were made",
  );
}

main();
