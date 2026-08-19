import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Table, TableStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { qrTokenExpiryFromNow } from './qr-token.util';
import {
  generateOrderPin,
  hashOrderPin,
} from './order-pin.util';

export type TableListFilters = {
  branchId?: string;
  status?: TableStatus;
};

export type TableWithOrderPin = Table & { orderPin?: string };

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateTableDto,
    currentUser: JwtPayload,
  ): Promise<TableWithOrderPin> {
    const branchId = await this.authorization.resolveBranch(
      currentUser,
      dto.branchId,
    );

    await this.ensureNumberAvailable(branchId, dto.number);

    const token = randomUUID();
    const orderPin = generateOrderPin();
    const orderPinHash = await hashOrderPin(orderPin);

    const table = await this.prisma.table.create({
      data: {
        branchId,
        qrToken: token,
        qrCode: token,
        qrTokenExpiresAt: this.nextQrExpiry(),
        orderPinHash,
        orderPinVersion: 1,
        number: dto.number,
        seats: dto.seats,
        notes: dto.notes,
      },
    });

    return { ...table, orderPin };
  }

  async findAll(
    currentUser: JwtPayload,
    filters: TableListFilters = {},
  ): Promise<Table[]> {
    const branchId = await this.authorization.resolveBranch(
      currentUser,
      filters.branchId,
    );

    return this.prisma.table.findMany({
      where: {
        branchId,
        deletedAt: null,
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { number: 'asc' },
    });
  }

  async findDeleted(
    currentUser: JwtPayload,
    filters: Pick<TableListFilters, 'branchId'> = {},
  ): Promise<Table[]> {
    const branchId = await this.authorization.resolveBranch(
      currentUser,
      filters.branchId,
    );

    return this.prisma.table.findMany({
      where: {
        branchId,
        deletedAt: { not: null },
      },
      orderBy: { number: 'asc' },
    });
  }

  async findOne(id: string, currentUser: JwtPayload): Promise<Table> {
    return this.getAccessibleTable(id, currentUser, { includeDeleted: false });
  }

  async update(
    id: string,
    dto: UpdateTableDto,
    currentUser: JwtPayload,
  ): Promise<Table> {
    const table = await this.getAccessibleTable(id, currentUser, {
      includeDeleted: false,
    });

    if (dto.number && dto.number !== table.number) {
      await this.ensureNumberAvailable(table.branchId, dto.number, id);
    }

    return this.prisma.table.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, currentUser: JwtPayload): Promise<Table> {
    const table = await this.getAccessibleTable(id, currentUser, {
      includeDeleted: false,
    });

    if (table.status === TableStatus.OCCUPIED) {
      throw new BadRequestException('Cannot delete an occupied table');
    }

    return this.prisma.table.update({
      where: { id },
      data: {
        active: false,
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
      },
    });
  }

  async restore(id: string, currentUser: JwtPayload): Promise<Table> {
    const table = await this.getAccessibleTable(id, currentUser, {
      includeDeleted: true,
    });

    if (!table.deletedAt) {
      throw new BadRequestException('Table is not deleted');
    }

    await this.ensureNumberAvailable(table.branchId, table.number, table.id);

    return this.prisma.table.update({
      where: { id },
      data: {
        active: true,
        deletedAt: null,
        deletedBy: null,
      },
    });
  }

  private async getAccessibleTable(
    id: string,
    currentUser: JwtPayload,
    options: { includeDeleted: boolean },
  ): Promise<Table> {
    const table = await this.prisma.table.findUnique({
      where: { id },
    });

    if (!table || (!options.includeDeleted && table.deletedAt)) {
      throw new NotFoundException('Table not found');
    }

    await this.authorization.canAccessBranch(currentUser, table.branchId);

    return table;
  }

  private async ensureNumberAvailable(
    branchId: string,
    number: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.table.findFirst({
      where: {
        branchId,
        number,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });

    if (!existing) {
      return;
    }

    if (existing.deletedAt) {
      throw new ConflictException(
        'A deleted table with this number exists. Restore it instead.',
      );
    }

    throw new ConflictException('Table number already exists');
  }

  async occupy(id: string, currentUser: JwtPayload): Promise<Table> {
    const table = await this.findOne(id, currentUser);

    if (table.status !== TableStatus.AVAILABLE) {
      throw new BadRequestException(`Table is currently ${table.status}`);
    }

    return this.prisma.table.update({
      where: { id },
      data: { status: TableStatus.OCCUPIED },
    });
  }

  async release(id: string, currentUser: JwtPayload): Promise<Table> {
    const table = await this.findOne(id, currentUser);

    if (table.status !== TableStatus.OCCUPIED) {
      throw new BadRequestException('Table is not occupied');
    }

    return this.prisma.table.update({
      where: { id },
      data: { status: TableStatus.AVAILABLE },
    });
  }

  async reserve(id: string, currentUser: JwtPayload): Promise<Table> {
    const table = await this.findOne(id, currentUser);

    if (table.status !== TableStatus.AVAILABLE) {
      throw new BadRequestException('Table cannot be reserved');
    }

    return this.prisma.table.update({
      where: { id },
      data: { status: TableStatus.RESERVED },
    });
  }

  async unreserve(id: string, currentUser: JwtPayload): Promise<Table> {
    const table = await this.findOne(id, currentUser);

    if (table.status !== TableStatus.RESERVED) {
      throw new BadRequestException('Table is not reserved');
    }

    return this.prisma.table.update({
      where: { id },
      data: { status: TableStatus.AVAILABLE },
    });
  }

  async available(
    currentUser: JwtPayload,
    filters: Pick<TableListFilters, 'branchId'> = {},
  ): Promise<Table[]> {
    const branchId = await this.authorization.resolveBranch(
      currentUser,
      filters.branchId,
    );

    return this.prisma.table.findMany({
      where: {
        branchId,
        active: true,
        deletedAt: null,
        status: TableStatus.AVAILABLE,
      },
      orderBy: { number: 'asc' },
    });
  }

  /** Rotate QR token, order PIN, and reset expiry. Old customer links stop working. */
  async rotateQrToken(
    id: string,
    currentUser: JwtPayload,
  ): Promise<TableWithOrderPin> {
    const table = await this.findOne(id, currentUser);
    const token = randomUUID();
    const orderPin = generateOrderPin();
    const orderPinHash = await hashOrderPin(orderPin);

    const updated = await this.prisma.table.update({
      where: { id: table.id },
      data: {
        qrToken: token,
        qrCode: token,
        qrTokenExpiresAt: this.nextQrExpiry(),
        orderPinHash,
        orderPinVersion: table.orderPinVersion + 1,
      },
    });

    return { ...updated, orderPin };
  }

  private nextQrExpiry(): Date {
    const ttlDays = Number(this.config.get('QR_TOKEN_TTL_DAYS') ?? 90);
    return qrTokenExpiryFromNow(ttlDays);
  }
}
