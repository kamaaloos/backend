import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConfigService } from '@nestjs/config';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

@Controller('uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadsController {
  constructor(private readonly config: ConfigService) {
    ensureUploadDir();
  }

  @Post()
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          ensureUploadDir();
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED.has(file.mimetype)) {
          cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const path = `/uploads/${file.filename}`;
    const configured = this.config.get<string>('PUBLIC_API_ORIGIN')?.replace(
      /\/$/,
      '',
    );
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = req.get('host');
    const origin = configured || `${proto}://${host}`;
    const url = `${origin}${path}`;

    return { url, path, filename: file.filename };
  }
}
