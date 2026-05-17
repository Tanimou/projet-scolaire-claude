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
  mfaEnabled: z.boolean(),
  photoUrl: z.string().url().nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
