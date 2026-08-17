#!/usr/bin/env node
/**
 * Offline safety validator for infra/gitops staging skeleton.
 *
 * Does not contact AWS, Kubernetes APIs, Docker, or the internet.
 * Optional: renders via `kubectl kustomize` when kubectl is on PATH.
 *
 * Exit 0: skeleton passes safety checks and is INTENTIONALLY NON-DEPLOYABLE
 *         (placeholder image still present) OR deployable-form checks when
 *         a digest-shaped image is used without other violations.
 * Exit 1: safety violation.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STAGING = path.join(ROOT, "infra", "gitops", "staging");

const REQUIRED = [
  "kustomization.yaml",
  "namespace.yaml",
  "resource-quota.yaml",
  "limit-range.yaml",
  "serviceaccount-api-gateway.yaml",
  "network-policy-default-deny.yaml",
  "network-policy-api-gateway.yaml",
  "api-gateway-deployment.yaml",
  "api-gateway-service.yaml",
];

const FORBIDDEN_PATTERNS = [
  { re: /:latest\b/i, msg: "forbidden image tag :latest" },
  { re: /kind:\s*Secret\b/, msg: "Kubernetes Secret resources are forbidden in this skeleton" },
  { re: /kind:\s*Ingress\b/, msg: "Ingress is forbidden in this skeleton slice" },
  { re: /kind:\s*ClusterRole\b/, msg: "ClusterRole is forbidden in this skeleton" },
  { re: /kind:\s*ClusterRoleBinding\b/, msg: "ClusterRoleBinding is forbidden" },
  { re: /type:\s*LoadBalancer\b/, msg: "LoadBalancer Service is forbidden" },
  { re: /0\.0\.0\.0\/0/, msg: "broad 0.0.0.0/0 egress/ingress is forbidden" },
  { re: /postgres:\/\/[^\s"'`]+/i, msg: "postgres connection string must not appear" },
  { re: /AKIA[0-9A-Z]{16}/, msg: "AWS access key pattern forbidden" },
  { re: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/, msg: "private key material forbidden" },
  { re: /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:/i, msg: "AWS ARN with account id forbidden" },
  {
    re: /password\s*[:=]\s*['"]?[^'"\s]{8,}/i,
    msg: "password assignment pattern forbidden",
  },
];

const PLACEHOLDER_IMAGE = "REPLACE_WITH_ECR_IMAGE_AT_DIGEST";

function fail(message) {
  console.error(`gitops-skeleton FAIL: ${message}`);
  process.exit(1);
}

function readStagingFiles() {
  const files = {};
  for (const name of REQUIRED) {
    const p = path.join(STAGING, name);
    if (!fs.existsSync(p)) {
      fail(`missing required file: infra/gitops/staging/${name}`);
    }
    files[name] = fs.readFileSync(p, "utf8");
  }
  return files;
}

function scanText(label, text) {
  for (const { re, msg } of FORBIDDEN_PATTERNS) {
    if (re.test(text)) {
      fail(`${label}: ${msg}`);
    }
  }
}

function extractImage(deploymentYaml) {
  const m = /image:\s*(\S+)/.exec(deploymentYaml);
  if (!m) {
    fail("api-gateway-deployment.yaml: missing image:");
  }
  return m[1].replace(/['"]/g, "");
}

function assertProbes(deploymentYaml) {
  const livePath = /livenessProbe:\r?\n[\s\S]*?path:\s*(\/\S+)/.exec(
    deploymentYaml,
  );
  const readyPath = /readinessProbe:\r?\n[\s\S]*?path:\s*(\/\S+)/.exec(
    deploymentYaml,
  );
  if (!livePath) {
    fail("livenessProbe path missing");
  }
  if (!readyPath) {
    fail("readinessProbe path missing");
  }
  if (livePath[1] !== "/health") {
    fail(`livenessProbe must use /health (got ${livePath[1]})`);
  }
  if (readyPath[1] !== "/ready") {
    fail(`readinessProbe must use /ready (got ${readyPath[1]})`);
  }
}

function assertSecurityContext(deploymentYaml) {
  if (!/runAsNonRoot:\s*true/.test(deploymentYaml)) {
    fail("pod/container must set runAsNonRoot: true");
  }
  if (!/allowPrivilegeEscalation:\s*false/.test(deploymentYaml)) {
    fail("container must set allowPrivilegeEscalation: false");
  }
  if (!/readOnlyRootFilesystem:\s*true/.test(deploymentYaml)) {
    fail("container must set readOnlyRootFilesystem: true");
  }
  if (!/type:\s*RuntimeDefault/.test(deploymentYaml)) {
    fail("seccompProfile RuntimeDefault required");
  }
  if (!/capabilities:[\s\S]*drop:[\s\S]*-\s*ALL/.test(deploymentYaml)) {
    fail("capabilities.drop must include ALL");
  }
  if (!/automountServiceAccountToken:\s*false/.test(deploymentYaml)) {
    fail("automountServiceAccountToken: false required");
  }
}

function assertService(serviceYaml) {
  if (!/type:\s*ClusterIP/.test(serviceYaml)) {
    fail("Service must be ClusterIP");
  }
  if (!/port:\s*3000/.test(serviceYaml)) {
    fail("Service must expose port 3000 (discovered container port)");
  }
}

function assertNoRoleBindings(files) {
  const joined = Object.values(files).join("\n");
  if (/kind:\s*Role\b/.test(joined) || /kind:\s*RoleBinding\b/.test(joined)) {
    fail("Role/RoleBinding present; skeleton must not add decorative RBAC");
  }
}

function tryKustomizeRender() {
  const result = spawnSync("kubectl", ["kustomize", STAGING], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error && result.error.code === "ENOENT") {
    console.log("gitops-skeleton: kubectl not on PATH — skip render");
    return { rendered: false, stdout: "" };
  }
  if (result.status !== 0) {
    fail(`kubectl kustomize failed: ${(result.stderr || "").slice(0, 400)}`);
  }
  scanText("kustomize-render", result.stdout);
  console.log("gitops-skeleton: kubectl kustomize render ok (offline)");
  return { rendered: true, stdout: result.stdout };
}

function main() {
  const files = readStagingFiles();
  for (const [name, text] of Object.entries(files)) {
    scanText(name, text);
  }

  // Templates may mention example shapes; still scan for real secrets.
  const templatesDir = path.join(STAGING, "templates");
  if (fs.existsSync(templatesDir)) {
    for (const ent of fs.readdirSync(templatesDir)) {
      const text = fs.readFileSync(path.join(templatesDir, ent), "utf8");
      scanText(`templates/${ent}`, text);
    }
  }

  assertNoRoleBindings(files);
  assertProbes(files["api-gateway-deployment.yaml"]);
  assertSecurityContext(files["api-gateway-deployment.yaml"]);
  assertService(files["api-gateway-service.yaml"]);

  if (!/name:\s*depp-staging/.test(files["namespace.yaml"])) {
    fail("namespace must be depp-staging");
  }
  if (!/synthetic-only/.test(files["namespace.yaml"])) {
    fail("namespace must label synthetic-only data classification");
  }

  const image = extractImage(files["api-gateway-deployment.yaml"]);
  let nonDeployable = false;

  if (image === PLACEHOLDER_IMAGE) {
    nonDeployable = true;
  } else if (/@sha256:[a-f0-9]{64}$/i.test(image)) {
    // Digest form — still not proof of a real registry push.
    console.log("gitops-skeleton: image uses digest form (still requires real ECR evidence)");
  } else if (/:/.test(image) && !/@sha256:/i.test(image)) {
    fail(`non-digest image reference forbidden: ${image}`);
  } else {
    fail(
      `image must be ${PLACEHOLDER_IMAGE} or an immutable @sha256: digest reference`,
    );
  }

  // Ensure sensitive env keys use secretKeyRef (not inline values).
  const dep = files["api-gateway-deployment.yaml"];
  for (const key of [
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "AUTH_MODE",
    "AUTH_EXPLICIT_ROLES_MODE",
  ]) {
    const block = new RegExp(
      `name:\\s*${key}\\s*\\n\\s*valueFrom:\\s*\\n\\s*secretKeyRef:`,
    );
    if (!block.test(dep)) {
      fail(`${key} must use valueFrom.secretKeyRef only`);
    }
  }

  const render = tryKustomizeRender();
  if (render.rendered && /REPLACE_WITH_ECR_IMAGE_AT_DIGEST/.test(render.stdout)) {
    nonDeployable = true;
  }

  console.log("");
  console.log("gitops-skeleton: safety checks PASSED");
  if (nonDeployable) {
    console.log(
      "gitops-skeleton: INTENTIONALLY NON-DEPLOYABLE — replace image placeholder with an approved ECR @sha256 digest before any apply",
    );
  }
  console.log(
    "gitops-skeleton: no AWS/Kubernetes/Docker/network calls were made by this validator",
  );
}

main();
