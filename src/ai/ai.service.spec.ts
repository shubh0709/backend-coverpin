import { ConfigService } from '@nestjs/config';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from './ai.service';
import { ComplianceEntity, EntityStatus, EntityType } from '../entities/entity.entity';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

const buildEntity = (): ComplianceEntity =>
  ({
    id: 'entity-1',
    name: 'Acme LLC',
    entityType: EntityType.LLC,
    jurisdiction: 'US-DE',
    status: EntityStatus.ACTIVE,
    formationDate: '2021-06-01',
  }) as ComplianceEntity;

const buildConfig = (overrides: Record<string, string | undefined> = {}) => {
  const values: Record<string, string | undefined> = {
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-4o-mini',
    ...overrides,
  };
  return { get: (key: string, fallback?: string) => values[key] ?? fallback } as ConfigService;
};

describe('AiService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('throws ServiceUnavailableException when no API key is configured', async () => {
    const service = new AiService(buildConfig({ OPENAI_API_KEY: undefined }));
    await expect(service.generateComplianceChecklist(buildEntity())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns a validated checklist on a well-formed response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Delaware LLC in good standing with one upcoming filing.',
              items: [
                {
                  filingType: 'Annual Report',
                  description: 'Delaware annual report and franchise tax.',
                  priority: 'HIGH',
                  suggestedDueDate: '2026-12-31',
                },
              ],
            }),
          },
        },
      ],
    });

    const service = new AiService(buildConfig());
    const result = await service.generateComplianceChecklist(buildEntity());

    expect(result.items).toHaveLength(1);
    expect(result.items[0].filingType).toBe('Annual Report');
  });

  it('rejects a response that fails schema validation instead of trusting it', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ items: [{ filingType: 'x' }] }), // missing required fields
          },
        },
      ],
    });

    const service = new AiService(buildConfig());
    await expect(service.generateComplianceChecklist(buildEntity())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('wraps a provider/network failure in a BadGatewayException', async () => {
    mockCreate.mockRejectedValue(new Error('network timeout'));

    const service = new AiService(buildConfig());
    await expect(service.generateComplianceChecklist(buildEntity())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
