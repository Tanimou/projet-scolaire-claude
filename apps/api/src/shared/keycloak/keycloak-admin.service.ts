import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
}

export interface KeycloakUserCreate {
  email: string;
  firstName: string;
  lastName: string;
  enabled?: boolean;
  emailVerified?: boolean;
  /** Realm roles to grant (e.g. ['school_admin']) */
  realmRoles?: string[];
  /** Required actions to set on the user (e.g. ['UPDATE_PASSWORD', 'CONFIGURE_TOTP']) */
  requiredActions?: string[];
  /** Optional initial credentials (temporary password) */
  temporaryPassword?: string;
}

/**
 * Thin client over Keycloak's Admin REST API.
 * Caches an admin-cli token and refreshes it transparently.
 *
 * Used for: invite flow, MFA enforcement, password reset email triggers, role management,
 * and any privileged Keycloak operation our app must perform without user interaction.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly masterUser: string;
  private readonly masterPassword: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('KEYCLOAK_URL') ?? 'http://localhost:8180';
    this.realm = config.get<string>('KEYCLOAK_REALM') ?? 'pilotage-scolaire';
    this.masterUser = config.get<string>('KEYCLOAK_ADMIN_USER') ?? 'admin';
    this.masterPassword = config.get<string>('KEYCLOAK_ADMIN_PASSWORD') ?? 'admin';
  }

  private async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt - 30 > now) return this.cachedToken.value;

    const res = await fetch(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: this.masterUser,
        password: this.masterPassword,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Keycloak admin token failed: ${res.status} ${text}`);
      throw new InternalServerErrorException('Keycloak admin token failed');
    }
    const token = (await res.json()) as TokenResponse;
    this.cachedToken = {
      value: token.access_token,
      expiresAt: now + token.expires_in,
    };
    return token.access_token;
  }

  private async adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return fetch(`${this.baseUrl}/admin/realms/${this.realm}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  /** Find a user by email. Returns null if not found. */
  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    const res = await this.adminFetch(`/users?email=${encodeURIComponent(email)}&exact=true`);
    if (!res.ok) throw new InternalServerErrorException(`Keycloak findUser: HTTP ${res.status}`);
    const users = (await res.json()) as Array<{ id: string; email: string }>;
    return users[0] ?? null;
  }

  /**
   * Create a user. Returns the Keycloak user ID.
   * If the email already exists, throws.
   */
  async createUser(payload: KeycloakUserCreate): Promise<string> {
    const body: Record<string, unknown> = {
      email: payload.email,
      username: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      enabled: payload.enabled ?? true,
      emailVerified: payload.emailVerified ?? false,
      requiredActions: payload.requiredActions ?? [],
    };
    if (payload.temporaryPassword) {
      body.credentials = [{ type: 'password', value: payload.temporaryPassword, temporary: true }];
    }

    const res = await this.adminFetch('/users', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text();
      throw new InternalServerErrorException(`Keycloak createUser: HTTP ${res.status} — ${text}`);
    }
    // Location: /admin/realms/<realm>/users/<id>
    const loc = res.headers.get('location') ?? '';
    const id = loc.split('/').pop();
    if (!id) throw new InternalServerErrorException('Keycloak createUser: missing location');

    if (payload.realmRoles?.length) {
      await this.assignRealmRoles(id, payload.realmRoles);
    }
    return id;
  }

  /** Assign realm roles to a user. */
  async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const rolesRes = await this.adminFetch(`/roles`);
    if (!rolesRes.ok) throw new InternalServerErrorException(`Keycloak roles: HTTP ${rolesRes.status}`);
    const allRoles = (await rolesRes.json()) as Array<{ id: string; name: string }>;
    const wanted = allRoles.filter((r) => roleNames.includes(r.name));
    if (wanted.length !== roleNames.length) {
      const missing = roleNames.filter((n) => !allRoles.find((r) => r.name === n));
      throw new InternalServerErrorException(`Unknown realm roles: ${missing.join(', ')}`);
    }
    const res = await this.adminFetch(`/users/${userId}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify(wanted.map((r) => ({ id: r.id, name: r.name }))),
    });
    if (!res.ok) throw new InternalServerErrorException(`Keycloak assignRealmRoles: HTTP ${res.status}`);
  }

  /**
   * Set or replace a user's password.
   * `temporary: true` (default) requires the user to change it on first login.
   * Use `temporary: false` for self-service registration where the user already chose it.
   */
  async setUserPassword(userId: string, password: string, temporary = true): Promise<void> {
    const res = await this.adminFetch(`/users/${userId}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: password, temporary }),
    });
    if (!res.ok) throw new InternalServerErrorException(`Keycloak setUserPassword: HTTP ${res.status}`);
  }

  /** Set required actions on a user (e.g. CONFIGURE_TOTP, UPDATE_PASSWORD). */
  async setRequiredActions(userId: string, actions: string[]): Promise<void> {
    const res = await this.adminFetch(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ requiredActions: actions }),
    });
    if (!res.ok) throw new InternalServerErrorException(`Keycloak setRequiredActions: HTTP ${res.status}`);
  }

  /**
   * Trigger Keycloak's built-in "Execute actions email" — sends the user an email
   * with a link that runs the listed actions (typically UPDATE_PASSWORD and/or VERIFY_EMAIL).
   * The link uses the given client_id and redirect_uri after completion.
   */
  async sendExecuteActionsEmail(
    userId: string,
    actions: string[],
    clientId?: string,
    redirectUri?: string,
  ): Promise<void> {
    const qs = new URLSearchParams();
    if (clientId) qs.set('client_id', clientId);
    if (redirectUri) qs.set('redirect_uri', redirectUri);
    const url = `/users/${userId}/execute-actions-email${qs.toString() ? `?${qs.toString()}` : ''}`;
    const res = await this.adminFetch(url, {
      method: 'PUT',
      body: JSON.stringify(actions),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`sendExecuteActionsEmail failed: ${res.status} ${text}`);
      throw new InternalServerErrorException(`Keycloak execute-actions-email: HTTP ${res.status}`);
    }
  }

  /**
   * Configure realm SMTP at runtime. Idempotent — used once at startup or via an admin endpoint.
   */
  async configureSmtp(smtp: {
    host: string;
    port: number;
    from: string;
    fromDisplayName?: string;
    auth?: { user: string; password: string };
    starttls?: boolean;
    ssl?: boolean;
  }): Promise<void> {
    const realmRes = await this.adminFetch(``);
    if (!realmRes.ok) throw new InternalServerErrorException(`Read realm: HTTP ${realmRes.status}`);
    const realm = (await realmRes.json()) as Record<string, unknown>;
    realm.smtpServer = {
      host: smtp.host,
      port: String(smtp.port),
      from: smtp.from,
      fromDisplayName: smtp.fromDisplayName ?? smtp.from,
      ...(smtp.auth ? { auth: 'true', user: smtp.auth.user, password: smtp.auth.password } : { auth: 'false' }),
      starttls: smtp.starttls ? 'true' : 'false',
      ssl: smtp.ssl ? 'true' : 'false',
    };
    const res = await this.adminFetch(``, { method: 'PUT', body: JSON.stringify(realm) });
    if (!res.ok) throw new InternalServerErrorException(`Update realm SMTP: HTTP ${res.status}`);
    this.logger.log(`Realm SMTP configured → ${smtp.host}:${smtp.port}`);
  }

  /** Build the Keycloak account reset-credentials URL (for "Forgot password" link). */
  resetCredentialsUrl(clientId: string, redirectUri: string): string {
    const qs = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
    return `${this.baseUrl}/realms/${this.realm}/login-actions/reset-credentials?${qs.toString()}`;
  }
}
