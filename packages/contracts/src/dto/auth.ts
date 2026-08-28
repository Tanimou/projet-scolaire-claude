import { z } from 'zod';

import { PORTALS } from '../enums';

import { EmailSchema, PasswordSchema, UuidSchema } from './common';

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Mot de passe requis'),
  portal: z.enum(PORTALS),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ParentRegisterRequestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: EmailSchema,
  phone: z.string().optional(),
  password: PasswordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Acceptation requise' }) }),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'Acceptation requise' }) }),
  marketingOptIn: z.boolean().default(false),
});
export type ParentRegisterRequest = z.infer<typeof ParentRegisterRequestSchema>;

export const InviteRegisterRequestSchema = z.object({
  inviteToken: z.string().min(20),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  password: PasswordSchema,
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
});
export type InviteRegisterRequest = z.infer<typeof InviteRegisterRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema,
});

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(20),
  password: PasswordSchema,
});

/**
 * La forme de `GET /api/v1/me`.
 *
 * ⚠ S-E05-8 / ADR-082 §D2 — CE SCHÉMA A UN JUMEAU TENU À LA MAIN :
 * `apps/web/src/lib/me.ts`. Les deux DOIVENT changer dans le MÊME commit, avec
 * la même nullabilité et le même sens documenté. Enregistré honnêtement : rien
 * n'appelle `.parse()` sur ce schéma aujourd'hui (recensé sur cet arbre), donc
 * les tenir ensemble est de l'HYGIÈNE, pas une contrainte exécutée — la preuve
 * de leur accord n'existe pas encore et n'est pas revendiquée ici. C'est
 * d'ailleurs par ce trou que `preferences` avait dérivé : le contrôleur le
 * renvoie depuis `S-E04-*`, le schéma ne le déclarait pas. Il est déclaré
 * ci-dessous plutôt que synchronisé une troisième fois à la main.
 */
export const MeResponseSchema = z.object({
  id: UuidSchema,
  email: EmailSchema,
  firstName: z.string(),
  lastName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  locale: z.string(),
  tenantId: UuidSchema,
  schoolId: UuidSchema.nullable(),
  /**
   * FAIT DE COMPTE, MESURÉ — et aujourd'hui JAMAIS mesuré.
   *
   * `null` signifie « jamais mesuré ». Ce n'est PAS un synonyme de `false`.
   * L'API n'émet actuellement QUE `null` : savoir si un utilisateur détient une
   * credential OTP exige un aller-retour vers l'API Admin de Keycloak sur le
   * chemin chaud de `/me`, ce que cette tranche ne fait délibérément pas
   * (PF-443). Un rendu doit distinguer TROIS états (`=== true` / `=== false` /
   * `=== null`) et jamais lire ce champ par sa véracité : `null` est faux-y, et
   * `{mfaEnabled && …}` afficherait « MFA actif » pour personne — ou, si le
   * champ devenait une sentinelle textuelle, pour tout le monde.
   */
  mfaEnabled: z
    .boolean()
    .nullable()
    .describe('null = jamais mesuré. PAS un synonyme de false. PF-443.'),
  /**
   * POLITIQUE, pas fait de compte.
   *
   * Dérivé avec ZÉRO E/S depuis les rôles realm du porteur, par LA règle
   * d'invitation unique (`mfaRequiredByInvitePolicy`,
   * `packages/contracts/src/security/mfa-enrolment-policy.ts`, ADR-004). Dit
   * « la politique d'invitation enrôle ce rôle dans `CONFIGURE_TOTP` », jamais
   * « cet utilisateur a configuré son MFA ». PF-446.
   */
  mfaRequired: z
    .boolean()
    .describe('Politique d’invitation pour les rôles realm du porteur (ADR-004). PF-446.'),
  photoUrl: z.string().url().nullable(),
  /**
   * Renvoyé par `me.controller.ts` depuis `S-E04-*` et déclaré ici seulement
   * maintenant : la dérive était réelle et silencieuse. `optional()` parce que
   * le jumeau web le déclare optionnel et qu'un déploiement plus ancien peut ne
   * pas l'émettre.
   */
  preferences: z.record(z.unknown()).optional(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
