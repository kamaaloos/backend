import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DeviceType } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, Socket } from 'socket.io';

import { AuthorizationService } from '../common/authorization/authorization.service';
import { buildCorsOptionsFromEnv } from '../common/cors.util';
import { DevicesService } from '../devices/devices.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { assertQrTokenValid } from '../tables/qr-token.util';
import {
  isRealtimeRoom,
  RealtimeRoomKind,
  restaurantRoom,
  branchRoom,
  roleRoom,
  tableRoom,
} from './rooms';
import { RealtimeEvents } from './events/realtime-events';
import { RealtimeEnvelope } from './events/event-envelope';

type JoinPayload = {
  branchId?: string;
  room: RealtimeRoomKind;
};

type SocketAuth =
  | {
      kind: 'user';
      user: JwtPayload;
    }
  | {
      kind: 'device';
      deviceId: string;
      deviceType: DeviceType;
      restaurantId: string;
      branchId: string;
    }
  | {
      kind: 'table';
      tableId: string;
      tableNumber: string;
      restaurantId: string;
      branchId: string;
      qrToken: string;
    };

const VALID_ROOMS: RealtimeRoomKind[] = [
  'kitchen',
  'waiter',
  'cashier',
  'customer',
  'pickup',
];

/** Refresh lastSeen for connected device sockets (under stale sweeper TTL). */
const DEVICE_PRESENCE_MS = 25_000;

@WebSocketGateway({
  // Same policy as HTTP CORS (wildcards like https://*.maylesoft.com).
  cors: buildCorsOptionsFromEnv(),
  namespace: '/realtime',
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  private readonly connections = new Map<string, SocketAuth>();
  private readonly deviceSockets = new Map<string, Set<string>>();
  private readonly staffSockets = new Map<string, Set<string>>();
  /** Per-socket timers that refresh device lastSeen while connected. */
  private readonly devicePresenceTimers = new Map<
    string,
    ReturnType<typeof setInterval>
  >();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authorization: AuthorizationService,
    private readonly devicesService: DevicesService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  afterInit(namespaceOrServer: Server | { server?: Server; adapter?: unknown }) {
    try {
      const adapterForcedOff =
        (process.env.REDIS_SOCKET_ADAPTER ?? 'true') === 'false';

      if (adapterForcedOff) {
        this.logger.warn(
          'Socket.IO using in-memory adapter (REDIS_SOCKET_ADAPTER=false)',
        );
        return;
      }

      if (!this.redis.isEnabled()) {
        this.logger.warn(
          'Socket.IO using in-memory adapter (Redis not connected) — fine for a single API instance',
        );
        return;
      }

      const candidate =
        this.server ??
        (namespaceOrServer as Server) ??
        (namespaceOrServer as { server?: Server }).server;

      const io =
        candidate && typeof (candidate as Server).adapter === 'function'
          ? (candidate as Server)
          : (candidate as unknown as { server?: Server })?.server;

      if (!io || typeof io.adapter !== 'function') {
        this.logger.warn(
          'Socket.IO server not ready for Redis adapter — using memory',
        );
        return;
      }

      const pub = this.redis.duplicate();
      const sub = this.redis.duplicate();
      if (!pub || !sub) {
        this.logger.warn(
          'Could not duplicate Redis clients for Socket.IO adapter — using memory',
        );
        return;
      }

      io.adapter(createAdapter(pub, sub));
      this.logger.log('Socket.IO Redis adapter enabled');
    } catch (err) {
      this.logger.warn(
        `Socket.IO Redis adapter failed (${(err as Error).message}) — using memory`,
      );
    }
  }

  async handleConnection(client: Socket) {
    try {
      const auth = await this.authenticate(client);
      client.data.auth = auth;
      this.connections.set(client.id, auth);

      if (auth.kind === 'device') {
        this.trackDeviceSocket(auth.deviceId, client.id);
        await this.devicesService.markOnline(auth.deviceId);
        this.startDevicePresence(client.id, auth.deviceId);
        const rooms = await this.autoJoinDevice(client, auth);
        client.emit(RealtimeEvents.CONNECTED, {
          kind: 'device',
          deviceId: auth.deviceId,
          deviceType: auth.deviceType,
          restaurantId: auth.restaurantId,
          branchId: auth.branchId,
          rooms,
        });
        this.logger.log(`Device connected: ${client.id} (${auth.deviceId})`);
      } else if (auth.kind === 'table') {
        const rooms = await this.autoJoinTableGuest(client, auth);
        client.emit(RealtimeEvents.CONNECTED, {
          kind: 'table',
          tableId: auth.tableId,
          tableNumber: auth.tableNumber,
          restaurantId: auth.restaurantId,
          branchId: auth.branchId,
          rooms,
        });
        this.logger.log(`Table guest connected: ${client.id} (${auth.tableId})`);
      } else {
        this.trackStaffSocket(auth.user.sub, client.id);
        client.emit(RealtimeEvents.CONNECTED, {
          kind: 'user',
          userId: auth.user.sub,
          role: auth.user.role,
        });
        this.logger.log(`Staff connected: ${client.id} (${auth.user.sub})`);
      }
    } catch (error) {
      this.logger.warn(`Unauthorized socket ${client.id}: ${String(error)}`);
      client.emit(RealtimeEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const auth =
      this.connections.get(client.id) ??
      (client.data.auth as SocketAuth | undefined);
    this.connections.delete(client.id);

    if (!auth) {
      this.logger.log(`Client disconnected: ${client.id}`);
      return;
    }

    if (auth.kind === 'device') {
      this.stopDevicePresence(client.id);
      const remaining = this.untrackDeviceSocket(auth.deviceId, client.id);
      if (remaining === 0) {
        await this.devicesService.markOffline(auth.deviceId);
      }
      this.logger.log(
        `Device disconnected: ${auth.deviceId} (sockets left: ${remaining})`,
      );
      return;
    }

    if (auth.kind === 'table') {
      this.logger.log(`Table guest disconnected: ${auth.tableId}`);
      return;
    }

    const remaining = this.untrackStaffSocket(auth.user.sub, client.id);
    this.logger.log(
      `Staff disconnected: ${auth.user.sub} (sockets left: ${remaining})`,
    );
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinPayload,
  ) {
    const auth = client.data.auth as SocketAuth | undefined;
    if (!auth) {
      return { ok: false, error: 'Unauthorized' };
    }

    if (auth.kind === 'device') {
      return {
        ok: false,
        error: 'Devices join automatically; join is for staff clients only',
      };
    }

    if (auth.kind === 'table') {
      return {
        ok: false,
        error: 'Table guests join automatically; join is for staff clients only',
      };
    }

    if (!VALID_ROOMS.includes(body.room)) {
      return { ok: false, error: 'Invalid room' };
    }

    try {
      const branchId = await this.authorization.resolveBranch(
        auth.user,
        body.branchId,
      );
      const restaurantId = await this.resolveRestaurantIdForBranch(
        auth.user,
        branchId,
      );

      await this.leaveRealtimeRooms(client);

      const rooms = [
        restaurantRoom(restaurantId),
        branchRoom(restaurantId, branchId),
        roleRoom(restaurantId, branchId, body.room),
      ];

      for (const room of rooms) {
        await client.join(room);
      }

      return { ok: true, rooms };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Join failed',
      };
    }
  }

  /** Low-level fan-out used by RealtimePublisher. */
  emitEnvelope<T>(
    restaurantId: string,
    branchId: string,
    kinds: RealtimeRoomKind[],
    event: string,
    envelope: RealtimeEnvelope<T>,
  ) {
    for (const kind of kinds) {
      this.server
        .to(roleRoom(restaurantId, branchId, kind))
        .emit(event, envelope);
    }
  }

  emitToTable<T>(
    restaurantId: string,
    branchId: string,
    tableId: string,
    event: string,
    envelope: RealtimeEnvelope<T>,
  ) {
    this.server
      .to(tableRoom(restaurantId, branchId, tableId))
      .emit(event, envelope);
  }

  isDeviceOnline(deviceId: string): boolean {
    return (this.deviceSockets.get(deviceId)?.size ?? 0) > 0;
  }

  isStaffOnline(userId: string): boolean {
    return (this.staffSockets.get(userId)?.size ?? 0) > 0;
  }

  private async leaveRealtimeRooms(client: Socket) {
    const rooms = [...client.rooms].filter(isRealtimeRoom);
    await Promise.all(rooms.map((room) => client.leave(room)));
  }

  private async autoJoinDevice(
    client: Socket,
    auth: Extract<SocketAuth, { kind: 'device' }>,
  ): Promise<string[]> {
    await this.leaveRealtimeRooms(client);

    const rooms = [
      restaurantRoom(auth.restaurantId),
      branchRoom(auth.restaurantId, auth.branchId),
      ...this.roomsForDeviceType(auth.deviceType).map((kind) =>
        roleRoom(auth.restaurantId, auth.branchId, kind),
      ),
    ];

    for (const room of rooms) {
      await client.join(room);
    }

    return rooms;
  }

  private async autoJoinTableGuest(
    client: Socket,
    auth: Extract<SocketAuth, { kind: 'table' }>,
  ): Promise<string[]> {
    await this.leaveRealtimeRooms(client);

    // Guests only join their private table room (no branch-wide customer room).
    const rooms = [
      tableRoom(auth.restaurantId, auth.branchId, auth.tableId),
    ];

    for (const room of rooms) {
      await client.join(room);
    }

    return rooms;
  }

  private roomsForDeviceType(deviceType: DeviceType): RealtimeRoomKind[] {
    switch (deviceType) {
      case DeviceType.KITCHEN:
        return ['kitchen'];
      case DeviceType.WAITER:
        return ['waiter'];
      case DeviceType.CASHIER:
        return ['cashier'];
      case DeviceType.CUSTOMER_DISPLAY:
        return ['pickup', 'customer'];
      case DeviceType.MANAGER:
        return ['kitchen', 'waiter', 'cashier', 'pickup'];
      default:
        return [];
    }
  }

  private async resolveRestaurantIdForBranch(
    user: JwtPayload,
    branchId: string,
  ): Promise<string> {
    if (user.restaurantId) {
      return user.restaurantId;
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { restaurantId: true },
    });

    if (!branch) {
      throw new Error('Branch not found');
    }

    return branch.restaurantId;
  }

  private trackDeviceSocket(deviceId: string, socketId: string) {
    const set = this.deviceSockets.get(deviceId) ?? new Set<string>();
    set.add(socketId);
    this.deviceSockets.set(deviceId, set);
  }

  private untrackDeviceSocket(deviceId: string, socketId: string): number {
    const set = this.deviceSockets.get(deviceId);
    if (!set) return 0;
    set.delete(socketId);
    if (set.size === 0) {
      this.deviceSockets.delete(deviceId);
      return 0;
    }
    return set.size;
  }

  /** Keep ONLINE + lastSeen fresh for the lifetime of a device socket. */
  private startDevicePresence(socketId: string, deviceId: string) {
    this.stopDevicePresence(socketId);
    const timer = setInterval(() => {
      void this.devicesService.markOnline(deviceId).catch((err: unknown) => {
        this.logger.warn(
          `Device presence refresh failed (${deviceId}): ${String(err)}`,
        );
      });
    }, DEVICE_PRESENCE_MS);
    this.devicePresenceTimers.set(socketId, timer);
  }

  private stopDevicePresence(socketId: string) {
    const timer = this.devicePresenceTimers.get(socketId);
    if (!timer) return;
    clearInterval(timer);
    this.devicePresenceTimers.delete(socketId);
  }

  private trackStaffSocket(userId: string, socketId: string) {
    const set = this.staffSockets.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.staffSockets.set(userId, set);
  }

  private untrackStaffSocket(userId: string, socketId: string): number {
    const set = this.staffSockets.get(userId);
    if (!set) return 0;
    set.delete(socketId);
    if (set.size === 0) {
      this.staffSockets.delete(userId);
      return 0;
    }
    return set.size;
  }

  private async authenticate(client: Socket): Promise<SocketAuth> {
    const auth = client.handshake.auth as {
      token?: string;
      deviceToken?: string;
      tableToken?: string;
      qrToken?: string;
      branchId?: string;
    };
    const header = client.handshake.headers.authorization;
    const bearer =
      auth?.token ??
      (typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : undefined);

    if (bearer) {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(bearer);
      return {
        kind: 'user',
        user: {
          sub: payload.sub,
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          restaurantId: payload.restaurantId ?? null,
          branchId: payload.branchId ?? null,
        },
      };
    }

    const deviceToken = auth?.deviceToken;
    if (deviceToken) {
      const device = await this.devicesService.findByToken(deviceToken);
      return {
        kind: 'device',
        deviceId: device.id,
        deviceType: device.deviceType,
        restaurantId: device.branch.restaurantId,
        branchId: device.branchId,
      };
    }

    const tableToken = auth?.tableToken ?? auth?.qrToken;
    if (tableToken) {
      const table = await this.prisma.table.findFirst({
        where: {
          OR: [{ qrToken: tableToken }, { qrCode: tableToken }],
          deletedAt: null,
          active: true,
        },
        include: { branch: true },
      });

      if (!table) {
        throw new Error('Invalid table token');
      }

      assertQrTokenValid(table);

      return {
        kind: 'table',
        tableId: table.id,
        tableNumber: table.number,
        restaurantId: table.branch.restaurantId,
        branchId: table.branchId,
        qrToken: table.qrToken ?? table.qrCode ?? tableToken,
      };
    }

    // Pickup TV must use a CUSTOMER_DISPLAY (or MANAGER) deviceToken —
    // bare branchId is no longer accepted.
    throw new Error('Missing token');
  }
}
