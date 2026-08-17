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
  mustInclude(wf, "CRITICAL", "critical severity");
  mustInclude(wf, "HIGH", "high severity");
  mustInclude(wf, "FOUNDER_ACK_HIGH_EXCEPTION", "founder exception ack");
  mustInclude(wf, "high-vuln-exception-record", "exception artifact");
  mustInclude(wf, "BLOCK:", "fail-closed block messaging");

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
