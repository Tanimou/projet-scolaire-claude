import { NotFoundException } from '@nestjs/common';
import {
  buildBrandingCss,
  sanitizeAssetUrl,
  sanitizeCssColor,
  sanitizeFontFamily,
  assertStyleTextIsInert,
} from '@pilotage/contracts';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateBrandingDto } from './branding.dto';
import { BrandingService } from './branding.service';

/**
 * S-E06-2 / PF-45 (+ PF-88) — preuves G-AUTHZ et G-TENANT du chemin de branding.
 *
 * Trois propriétés y sont vérifiées, et chacune protège une moitié différente :
 *  1. la grammaire d'assainissement REJETTE les charges hostiles connues ET
 *     ACCEPTE les valeurs réellement utilisées par le produit (un assainisseur
 *     qui refuse tout passerait la moitié « sécurité » en cassant la
 *     fonctionnalité — R-12) ;
 *  2. le DTO refuse à l'écriture ;
 *  3. le rendu neutralise ce qui est DÉJÀ en base, écrit avant le DTO ;
 *  4. une écriture visant l'école d'un autre locataire est refusée.
 */

/**
 * Charges hostiles. La première est la sévère : elle tient dans les 60
 * caractères de `@MaxLength`, ferme l'élément `<style>` et ouvre un `<script>`.
 */
const HOSTILE_COLORS = [
  'red}</style><script>alert(1)</script>',
  'red;} body{display:none} .x{color:red',
  'url("https://evil.example/x")',
  'expression(alert(1))',
  'var(--x); background:url(//evil.example/i)',
  '#fff"/><script>alert(1)</script>',
  'rgb(0,0,0)}</style><img src=x onerror=alert(1)>',
  // Échappement CSS : `\3c` est un `<` pour l'analyseur CSS. La grammaire
  // n'admet pas `\`, donc cette forme meurt sans qu'on ait à la reconnaître.
  '\\3c /style\\3e',
];

/** Valeurs que le produit utilise réellement — cf. `BrandingForm#PRESET_COLORS`. */
const LEGITIMATE_COLORS = [
  'oklch(0.62 0.18 250)',
  'oklch(0.55 0.22 280)',
  '#2563eb',
  '#2563EBFF',
  '#fff',
  'rgb(37, 99, 235)',
  'rgba(37,99,235,0.5)',
  'hsl(217 91% 60%)',
  'oklch(0.62 0.18 250 / 50%)',
  'transparent',
  'currentColor',
];

describe('sanitizeCssColor — grammaire close (G-AUTHZ)', () => {
  it.each(LEGITIMATE_COLORS)('accepts the product value %s', (value) => {
    expect(sanitizeCssColor(value)).toBe(value);
  });

  it.each(HOSTILE_COLORS)('rejects %s', (value) => {
    expect(sanitizeCssColor(value)).toBeNull();
  });

  it('rejects a value that exceeds the declared maximum length', () => {
    expect(sanitizeCssColor(`rgb(${'1'.repeat(80)})`)).toBeNull();
  });

  it('rejects non-strings without throwing', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(sanitizeCssColor(value)).toBeNull();
    }
  });

  it('rejects a nested function even when the outer name is allowed', () => {
    // `(` et `)` sont hors de la grammaire d'arguments : c'est ce qui met
    // `url()`, `var()` et `expression()` hors d'atteinte par composition.
    expect(sanitizeCssColor('rgb(var(--x))')).toBeNull();
  });
});

describe('sanitizeFontFamily', () => {
  it('re-serialises a legitimate list and quotes multi-word names', () => {
    expect(sanitizeFontFamily('Inter, Helvetica Neue, sans-serif')).toBe(
      'Inter, "Helvetica Neue", sans-serif',
    );
  });

  it('drops the surrounding quotes it received and re-adds its own', () => {
    expect(sanitizeFontFamily('"Helvetica Neue"')).toBe('"Helvetica Neue"');
  });

  it.each([
    'Inter";}</style><script>alert(1)</script>',
    'Inter, url(evil)',
    'Inter; background:red',
    'Inter\\3c /style',
  ])('rejects the whole list when any name is hostile: %s', (value) => {
    expect(sanitizeFontFamily(value)).toBeNull();
  });
});

describe('sanitizeAssetUrl', () => {
  it.each(['https://cdn.example/logo.png', 'http://minio:9000/b/logo.png', '/uploads/logo.png'])(
    'accepts %s',
    (value) => {
      expect(sanitizeAssetUrl(value)).not.toBeNull();
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'vbscript:msgbox(1)',
    '//evil.example/logo.png',
    'https://evil.example/a b',
  ])('rejects %s', (value) => {
    expect(sanitizeAssetUrl(value)).toBeNull();
  });
});

describe('buildBrandingCss — le rendu est sûr indépendamment de ce qui est stocké', () => {
  it('emits only the declarations whose values survived the grammar', () => {
    expect(
      buildBrandingCss({ primaryColor: '#2563eb', accentColor: 'oklch(0.55 0.22 280)', fontFamily: 'Inter' }),
    ).toBe(':root{--brand-primary:#2563eb;--brand-accent:oklch(0.55 0.22 280);--brand-font:Inter;}');
  });

  it.each(HOSTILE_COLORS)('neutralises a row already in the database carrying %s', (value) => {
    // C'est la moitié que la validation d'écriture ne couvre PAS : ces lignes
    // ont été écrites avant le DTO, ou par un script de seed qui ne le traverse
    // jamais. La variable disparaît, le portail retombe sur sa valeur par défaut.
    const css = buildBrandingCss({ primaryColor: value });
    expect(css).toBe(':root{}');
    expect(css).not.toContain('<');
    expect(css).not.toContain('script');
  });

  it('never emits a character able to terminate the <style> element', () => {
    const css = buildBrandingCss({
      primaryColor: '</style><script>alert(1)</script>',
      accentColor: '\\3c/style\\3e',
      fontFamily: '"><script>alert(1)</script>',
    });
    expect(() => assertStyleTextIsInert(css)).not.toThrow();
  });

  it('tolerates null, undefined and a completely absent branding payload', () => {
    expect(buildBrandingCss(null)).toBe(':root{}');
    expect(buildBrandingCss(undefined)).toBe(':root{}');
    expect(buildBrandingCss({})).toBe(':root{}');
  });
});

describe('assertStyleTextIsInert — garde-fou terminal', () => {
  // Ce garde-fou est redondant PAR CONCEPTION avec la grammaire : il ne connaît
  // pas les couleurs, seulement la propriété dont dépend la sécurité du rendu.
  // Sans ce test il pourrait devenir une fonction qui ne lève jamais.
  it.each(['a<b', 'a>b', 'a\\b', 'a\u0000b'])('throws on %j', (css) => {
    expect(() => assertStyleTextIsInert(css)).toThrow(/terminate a <style>/);
  });

  it('returns the css unchanged when it is inert', () => {
    expect(assertStyleTextIsInert(':root{--brand-primary:#fff;}')).toBe(':root{--brand-primary:#fff;}');
  });
});

describe('UpdateBrandingDto — refus à l\'écriture (G-AUTHZ)', () => {
  const validate = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateBrandingDto, payload), { whitelist: true });

  it.each(HOSTILE_COLORS)('rejects primaryColor=%s', (value) => {
    const errors = validate({ primaryColor: value });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('primaryColor');
  });

  it('accepts every colour the branding form can produce', () => {
    for (const value of LEGITIMATE_COLORS) {
      expect(validate({ primaryColor: value })).toHaveLength(0);
    }
  });

  it('rejects a javascript: favicon and a hostile font list', () => {
    expect(validate({ faviconUrl: 'javascript:alert(1)' })).toHaveLength(1);
    expect(validate({ fontFamily: 'Inter";}</style><script>x</script>' })).toHaveLength(1);
  });

  it('still allows a payload that omits every optional field', () => {
    expect(validate({})).toHaveLength(0);
  });
});

describe('BrandingService.update — portée locataire (G-TENANT, PF-88)', () => {
  function makeService(school: { id: string; tenantId: string } | null) {
    const prisma = {
      school: {
        // Reproduit la sémantique de Prisma : `findFirst` applique TOUT le
        // `where`, donc un `tenantId` qui ne correspond pas renvoie null.
        findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) =>
          school && school.id === where.id && school.tenantId === where.tenantId
            ? { ...school, name: 'École', schoolCode: 'SC1' }
            : null,
        ),
      },
      branding: { upsert: jest.fn(async () => ({ displayName: 'x', primaryColor: '#fff', accentColor: null, fontFamily: null, logoUrl: null, faviconUrl: null })) },
    };
    return { service: new BrandingService(prisma as never), prisma };
  }

  it('denies a write aimed at a school owned by another tenant', async () => {
    const { service, prisma } = makeService({ id: 'school-of-tenant-b', tenantId: 'tenant-b' });
    await expect(
      service.update('tenant-a', 'school-of-tenant-b', { primaryColor: '#fff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // La ligne d'un autre locataire n'est jamais écrite…
    expect(prisma.branding.upsert).not.toHaveBeenCalled();
    // …et la contrainte est DANS la requête, pas dans une comparaison faite
    // après lecture : il n'existe donc pas de chemin où on l'a déjà lue.
    expect(prisma.school.findFirst).toHaveBeenCalledWith({
      where: { id: 'school-of-tenant-b', tenantId: 'tenant-a' },
    });
  });

  it('allows the write when the school belongs to the caller tenant', async () => {
    // Le chemin positif compte autant : une garde qui refuse tout satisferait
    // le test négatif et casserait le produit (R-12).
    const { service, prisma } = makeService({ id: 'school-a', tenantId: 'tenant-a' });
    await expect(service.update('tenant-a', 'school-a', { primaryColor: '#fff' })).resolves.toMatchObject({
      schoolId: 'school-a',
    });
    expect(prisma.branding.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not accept a signature that could be called without a tenant', () => {
    // `update(tenantId, schoolId, patch)` — 3 paramètres. Si quelqu'un
    // rétablissait `update(schoolId, patch)`, ce test le nomme.
    expect(BrandingService.prototype.update).toHaveLength(3);
  });
});
