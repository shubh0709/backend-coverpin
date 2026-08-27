import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistryService } from './registry.service';

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
      'Upload entities.csv, ownership.csv, and filings.csv (or .xlsx) together. Validates the whole batch and writes nothing if any error exists.',
  })
  @ApiConsumes('multipart/form-data')
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

    if (!entities || !ownership || !filings) {
      throw new BadRequestException(
        'All three files are required: entities (field "entities"), ownership (field "ownership"), filings (field "filings").',
      );
    }

    return this.registryService.processUpload({ entities, ownership, filings });
  }
}
