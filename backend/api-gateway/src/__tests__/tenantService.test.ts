import { prisma } from '../lib/prisma';
import { getTenantProfile } from '../services/tenantService';

jest.mock('../lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: jest.fn(),
    },
  },
}));

const mockedFindUnique = prisma.tenant.findUnique as jest.Mock;

describe('getTenantProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('looks up tenant by id only', async () => {
    const createdAt = new Date('2024-01-01');
    mockedFindUnique.mockResolvedValue({
      id: 'tenant-a',
      name: 'Acme Corp',
      createdAt,
    });

    const result = await getTenantProfile('tenant-a');

    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-a' },
      select: { id: true, name: true, createdAt: true },
    });
    expect(result).toEqual({ id: 'tenant-a', name: 'Acme Corp', createdAt });
  });

  it('returns null when tenant does not exist', async () => {
    mockedFindUnique.mockResolvedValue(null);

    const result = await getTenantProfile('missing-tenant');

    expect(result).toBeNull();
  });
});
