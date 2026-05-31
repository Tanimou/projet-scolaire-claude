import { MeController } from './me.controller';
import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  preferences: Record<string, unknown>;
};

type TeacherRow = { specialty: string | null; hiredAt: Date | null; externalRef: string | null };

function makeController(opts: { user?: Partial<UserRow>; teacher?: TeacherRow | null } = {}) {
  const userRow: UserRow = {
    id: 'u1',
    firstName: 'Marc',
    lastName: 'Robert',
    email: 'marc@voltaire.fr',
    phone: null,
    photoUrl: null,
    preferences: {},
    ...opts.user,
  };
  let teacherRow: TeacherRow | null = opts.teacher ?? null;

  const users = {
    ensureUser: jest.fn(async () => userRow),
  };
  const prisma = {
    userProfile: {
      update: jest.fn(async ({ data }: { data: Partial<UserRow> }) => {
        Object.assign(userRow, data);
        return userRow;
      }),
      findUnique: jest.fn(async () => userRow),
    },
    teacherProfile: {
      findUnique: jest.fn(async () => teacherRow),
      update: jest.fn(async ({ data }: { data: Partial<TeacherRow> }) => {
        teacherRow = { ...(teacherRow as TeacherRow), ...data };
        return teacherRow;
      }),
    },
  };

  const controller = new MeController(users as never, prisma as never);
  const jwt = { sub: 'kc-1' } as KeycloakJwtPayload;
  return { controller, prisma, users, jwt, userRow, getTeacher: () => teacherRow };
}

describe('MeController.updateProfile', () => {
  it('persists phone and bio for any user', async () => {
    const { controller, prisma, jwt } = makeController();
    const res = await controller.updateProfile({ phone: ' 06 12 ', bio: 'Bonjour' }, jwt);

    expect(prisma.userProfile.update).toHaveBeenCalledTimes(1);
    const data = prisma.userProfile.update.mock.calls[0]![0].data;
    expect(data.phone).toBe('06 12');
    expect((data.preferences as { profile: { bio: string } }).profile.bio).toBe('Bonjour');
    expect(prisma.teacherProfile.update).not.toHaveBeenCalled();
    expect(res.data.phone).toBe('06 12');
    expect(res.data.bio).toBe('Bonjour');
    expect(res.data.isTeacher).toBe(false);
    expect(res.data.specialty).toBeNull();
  });

  it('updates specialty when the caller has a teacher profile', async () => {
    const { controller, prisma, jwt } = makeController({
      teacher: { specialty: 'Maths', hiredAt: null, externalRef: 'T-01' },
    });
    const res = await controller.updateProfile({ specialty: 'Physique-Chimie' }, jwt);

    expect(prisma.teacherProfile.update).toHaveBeenCalledTimes(1);
    expect(prisma.teacherProfile.update.mock.calls[0]![0].data.specialty).toBe('Physique-Chimie');
    expect(res.data.isTeacher).toBe(true);
    expect(res.data.specialty).toBe('Physique-Chimie');
    expect(res.data.externalRef).toBe('T-01');
  });

  it('silently ignores specialty for a non-teacher', async () => {
    const { controller, prisma, jwt } = makeController({ teacher: null });
    const res = await controller.updateProfile({ specialty: 'Maths' }, jwt);

    expect(prisma.teacherProfile.update).not.toHaveBeenCalled();
    expect(res.data.isTeacher).toBe(false);
    expect(res.data.specialty).toBeNull();
  });

  it('clears a field to null when given an empty string', async () => {
    const { controller, prisma, jwt } = makeController({
      user: { phone: '0600000000' },
    });
    const res = await controller.updateProfile({ phone: '   ' }, jwt);

    expect(prisma.userProfile.update.mock.calls[0]![0].data.phone).toBeNull();
    expect(res.data.phone).toBeNull();
  });

  it('touches nothing when no editable field is provided', async () => {
    const { controller, prisma, jwt } = makeController({
      teacher: { specialty: 'Maths', hiredAt: null, externalRef: null },
    });
    await controller.updateProfile({}, jwt);

    expect(prisma.userProfile.update).not.toHaveBeenCalled();
    expect(prisma.teacherProfile.update).not.toHaveBeenCalled();
  });
});
