import { Controller, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RegistryService } from './registry.service';
import {
  UploadResultDto,
  UploadValidationErrorResponseDto,
} from './dto/upload-response.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

interface UploadFileFields {
  entities?: Express.Multer.File[];
  ownership?: Express.Multer.File[];
  filings?: Express.Multer.File[];
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(private readonly registryService: RegistryService) {}

  @Post()
  @ApiOperation({
    summary:
      'Upload entities.csv, ownership.csv, and filings.csv (or .xlsx) together.',
    description: `Validates the whole batch first — if any row in any file has an error, nothing is
written and every error found is returned at once (HTTP 422), sorted file → line → column.
All three fields are required on every call, even for a partial re-upload; re-send the
unchanged files as-is. Each file may be \`.csv\` or a single-sheet \`.xlsx\`, up to 10 MB.
Writes are upserts keyed on natural keys (Entity Name; parent/child pair; entity/filing
type/due-date), so re-uploading the same data is safe to retry.

Required columns:
- **entities**: Entity Name, Registration Type, Jurisdiction, Entity Type, Entity Status, Status Date, Domestic Entity, Formation Date, Entity/Business ID, Global Region
- **ownership**: Parent Entity, Child Entity, Ownership %
- **filings**: Entity Name, Filing Type, Jurisdiction, Filing Authority, Due Date, Filed Date, Status`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'All three fields are required. Field name must match exactly: entities, ownership, filings.',
    schema: {
      type: 'object',
      required: ['entities', 'ownership', 'filings'],
      properties: {
        entities: {
          type: 'string',
          format: 'binary',
          description: 'entities.csv or entities.xlsx',
        },
        ownership: {
          type: 'string',
          format: 'binary',
          description: 'ownership.csv or ownership.xlsx',
        },
        filings: {
          type: 'string',
          format: 'binary',
          description: 'filings.csv or filings.xlsx',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Batch validated and written; row counts upserted per file.',
    type: UploadResultDto,
  })
  @ApiBadRequestResponse({
    description:
      'The multipart request itself was malformed (e.g. an unexpected field name or an oversized file).',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The batch failed validation — a required file field was not sent, a file was unreadable, bad header, bad field values, duplicate keys, ownership cycles, ownership >100%, etc. — nothing was written.',
    type: UploadValidationErrorResponseDto,
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'entities', maxCount: 1 },
        { name: 'ownership', maxCount: 1 },
        { name: 'filings', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_FILE_SIZE_BYTES } },
    ),
  )
  async upload(@UploadedFiles() files: UploadFileFields) {
    const entities = files?.entities?.[0];
    const ownership = files?.ownership?.[0];
    const filings = files?.filings?.[0];

    // A missing file is reported as a structural validation error (422),
    // in the same {file, line, column, message} shape as every other error
    // — see ValidationService.validateUpload — rather than a bare 400.
    return this.registryService.processUpload({ entities, ownership, filings });
  }
}
