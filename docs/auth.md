# Auth — JWT Strategy

## Overview

DEPP uses custom JWT-based authentication with short-lived access tokens and longer-lived refresh tokens. All tokens carry a `tenantId` claim — every protected route can enforce tenant isolation without an extra DB lookup.

---

## Token shapes

### Access token payload
```json
{
  "sub": "<userId>",
  "tenantId": "<tenantId>",
  "role": "owner | admin | analyst | read-only",
  "iat": 1234567890,
  "exp": 1234568790
}
```
Default lifetime: **15 minutes** (`JWT_ACCESS_EXPIRES_IN`).

### Refresh token payload
```json
{
  "sub": "<userId>",
  "tenantId": "<tenantId>",
  "jti": "<refreshToken.id>",
  "iat": 1234567890,
  "exp": 1235172690
}
```
Default lifetime: **7 days** (`JWT_REFRESH_EXPIRES_IN`).

The `jti` field maps to a row in the `refresh_tokens` table. Revocation is done by setting `isRevoked = true` on that row.

---

## Roles

| Role | Description |
|---|---|
| `owner` | Full access; can manage tenants and other owners |
| `admin` | Manages users and policies within a tenant |
| `analyst` | Can view alerts, telemetry, and triage incidents |
| `read-only` | Read access to dashboards and reports only |

Roles are stored on the `User` row and embedded in the token at login time. They are **never** trusted from the request body.

---

## Endpoints

### `POST /auth/login`

Authenticates a user and returns a token pair.

**Request**
```json
{
  "email": "user@example.com",
  "password": "plaintext-password"
}
```

**Response `200`**
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

**Response `401`** — wrong credentials (same body for wrong password and unknown email; no enumeration)
```json
{ "error": "Invalid credentials" }
```

---

### `POST /auth/refresh`

Rotates a refresh token. The old token is revoked immediately; a new pair is issued.

**Request**
```json
{ "refreshToken": "<jwt>" }
```

**Response `200`**
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

**Response `401`** — token expired, revoked, or malformed
```json
{ "error": "Invalid or expired refresh token" }
```

---

### `GET /auth/me` _(protected)_

Returns the authenticated caller's identity from the token. Used to verify a token is valid and inspect its claims.

**Headers**
```
Authorization: Bearer <accessToken>
```

**Response `200`**
```json
{
  "userId": "<uuid>",
  "tenantId": "<uuid>",
  "role": "analyst"
}
```

**Response `401`** — missing, malformed, expired, or wrong-secret token
```json
{ "error": "Invalid or expired token" }
```

---

## authenticate middleware

`src/middleware/authenticate.ts` — attach to any route that requires a valid session.

For tenant-scoped routes, prefer the `tenantScoped` chain instead of calling `authenticate` alone. See [tenancy.md](./tenancy.md).

```typescript
import { authenticate } from '../middleware/authenticate';
import { AuthenticatedRequest } from '../types/auth';

router.get('/some-resource', authenticate, (req, res) => {
  const { userId, tenantId, role } = (req as AuthenticatedRequest).auth;
  // ...
});
```

The middleware rejects with `401` on: missing header, non-Bearer scheme, expired token, wrong secret, tampered signature, or missing `tenantId`/`role` claims.

### Tenant-scoped routes

```typescript
import { tenantScoped } from '../middleware/tenantScoped';
import { TenantScopedRequest } from '../types/tenant';

router.use(...tenantScoped);
router.get('/tenant-resource', (req, res) => {
  const { tenantId } = (req as TenantScopedRequest).tenant;
  // all queries must filter by tenantId
});
```

---

## Refresh token lifecycle

1. On login, a `RefreshToken` row is created with a UUID (`jti`), `userId`, and `expiresAt`.
2. On refresh, the existing row is looked up by `jti`, checked for `isRevoked` and `expiresAt`, then set `isRevoked = true`.
3. A new `RefreshToken` row is created and a new pair is issued.
4. On logout (not yet implemented), set `isRevoked = true` on all of the user's active refresh tokens.

---

## Security notes

- Passwords are hashed with **bcrypt (cost factor 12)**; plaintext is never stored or logged.
- Unknown email and wrong password return identical responses and take the same time (constant-time bcrypt compare with a dummy hash).
- Access tokens are stateless; they cannot be revoked before expiry. Keep the lifetime short (15 min default).
- Refresh tokens are stateful and revocable. Use HTTPS in all environments.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be different secrets, each at least 32 random characters.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | yes | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | yes | — | Secret for signing refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | no | `7d` | Refresh token lifetime |
| `DATABASE_URL` | yes | — | Postgres connection string |

See `.env.example` for the full template.
