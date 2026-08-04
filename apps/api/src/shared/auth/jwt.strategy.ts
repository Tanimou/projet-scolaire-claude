import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { MissingConfigError } from '../config/config-preflight';

export interface KeycloakJwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  azp?: string; // authorized party — the client_id that received the token
  iss?: string;
  exp?: number;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'keycloak-jwt') {
  constructor(config: ConfigService) {
    // `KEYCLOAK_URL` n'a plus de défaut (S-E06-1 / PF-54) : sur le chemin
    // d'authentification, une URL devinée fait chercher les JWKS ailleurs que
    // là où les jetons sont signés — donc 401 partout, sans indice. La variable
    // est exigée au démarrage par `assertRequiredConfig` (main.ts) ; ici on
    // constate seulement qu'elle est là.
    const keycloakUrl = config.get<string>('KEYCLOAK_URL');
    if (keycloakUrl === undefined || keycloakUrl.trim() === '') {
      throw new MissingConfigError(['KEYCLOAK_URL']);
    }
    // Browser-facing issuer (Keycloak KC_HOSTNAME). Tokens carry this in `iss`
    // whether minted via the internal host (ROPC) or the browser host (OIDC).
    // JWKS are still fetched over the internal URL the api can actually reach.
    // Falls back to KEYCLOAK_URL when no split is configured (backward-compatible).
    const publicUrl = config.get<string>('KEYCLOAK_PUBLIC_URL') ?? keycloakUrl;
    const realm = config.get<string>('KEYCLOAK_REALM') ?? 'pilotage-scolaire';
    const issuer = `${publicUrl}/realms/${realm}`;
    const jwksIssuer = `${keycloakUrl}/realms/${realm}`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${jwksIssuer}/protocol/openid-connect/certs`,
      }),
      issuer,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: KeycloakJwtPayload): Promise<KeycloakJwtPayload> {
    if (!payload.sub) throw new UnauthorizedException('Missing subject');
    return payload;
  }
}
