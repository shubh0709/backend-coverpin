import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import OpenAI from 'openai';
import { ComplianceEntity } from '../entities/entity.entity';
import { ComplianceChecklistResultDto } from './dto/compliance-checklist-result.dto';

const CHECKLIST_JSON_SCHEMA = {
  name: 'compliance_checklist',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            filingType: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            suggestedDueDate: { type: 'string' },
          },
          required: ['filingType', 'description', 'priority', 'suggestedDueDate'],
        },
      },
    },
    required: ['summary', 'items'],
  },
} as const;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): OpenAI {
    if (this.client) return this.client;

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured on the server. Set it in .env to enable AI features.',
      );
    }
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  /**
   * Calls the LLM to draft a compliance checklist for an entity, then validates
   * the structured output before it is trusted anywhere downstream. LLMs can
   * hallucinate or return malformed data even under a JSON schema, so this is
   * treated as untrusted input until it passes validation.
   */
  async generateComplianceChecklist(
    entity: ComplianceEntity,
  ): Promise<ComplianceChecklistResultDto> {
    const client = this.getClient();
    const model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');

    const prompt = [
      'You are a compliance operations assistant for a company that manages business entities',
      'across jurisdictions (formation, licenses, taxes, filings). Given an entity, propose the',
      'most likely upcoming compliance filings it will need, based on its jurisdiction, entity type,',
      'and status. Be specific about filing types (e.g. Annual Report, BOI Report, Franchise Tax,',
      'Registered Agent Renewal). If you are not confident about an exact due date, make a',
      'reasonable estimate and say so in the description rather than inventing a false-precision date.',
      '',
      `Entity name: ${entity.name}`,
      `Entity type: ${entity.entityType}`,
      `Jurisdiction: ${entity.jurisdiction}`,
      `Current status: ${entity.status}`,
      `Formation date: ${entity.formationDate ?? 'unknown'}`,
    ].join('\n');

    let raw: string | null;
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: CHECKLIST_JSON_SCHEMA },
        temperature: 0.2,
      });
      raw = completion.choices[0]?.message?.content ?? null;
    } catch (error) {
      this.logger.error(`OpenAI call failed: ${(error as Error).message}`);
      throw new BadGatewayException(
        'The AI provider request failed. Please retry in a moment.',
      );
    }

    if (!raw) {
      throw new BadGatewayException('The AI provider returned an empty response.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadGatewayException('The AI provider returned malformed JSON.');
    }

    const instance = plainToInstance(ComplianceChecklistResultDto, parsed);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      this.logger.warn(`AI output failed validation: ${JSON.stringify(errors)}`);
      throw new BadGatewayException(
        'The AI provider returned a response that did not match the expected schema.',
      );
    }

    return instance;
  }
}
