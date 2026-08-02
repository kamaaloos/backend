/// <reference types="jest" />
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';

/**
 * Full vertical: customer QR order → kitchen → waiter → payment → COMPLETED.
 * Requires a running Postgres with seeded demo data (see scripts/seed.ts).
 */
describe('Order flow (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: string;
  let branchId: string;
  let qrToken: string;
  let kitchenDeviceToken: string;
  let waiterDeviceToken: string;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_TTL_MS = '60000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@restaurant.local',
        password: 'admin123',
      });
    expect([200, 201]).toContain(login.status);

    jwt = login.body.access_token ?? login.body.accessToken;
    expect(jwt).toBeTruthy();

    const branches = await request(app.getHttpServer())
      .get('/api/branches')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(branches.body.length).toBeGreaterThan(0);
    branchId = branches.body[0].id;

    const tables = await request(app.getHttpServer())
      .get(`/api/tables?branchId=${branchId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    const table =
      tables.body.find(
        (t: { qrToken?: string; number?: string }) =>
          t.qrToken === 'c295c2df-cc43-49bd-8bd5-5f7484fa9061',
      ) ?? tables.body.find((t: { qrToken?: string }) => !!t.qrToken);

    expect(table?.qrToken).toBeTruthy();
    qrToken = table.qrToken;

    const kitchenDevice = await request(app.getHttpServer())
      .post('/api/devices')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        name: `E2E Kitchen ${Date.now()}`,
        deviceType: 'KITCHEN',
        branchId,
      });
    expect([200, 201]).toContain(kitchenDevice.status);

    kitchenDeviceToken = kitchenDevice.body.token;

    const waiterDevice = await request(app.getHttpServer())
      .post('/api/devices')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        name: `E2E Waiter ${Date.now()}`,
        deviceType: 'WAITER',
        branchId,
      });
    expect([200, 201]).toContain(waiterDevice.status);

    waiterDeviceToken = waiterDevice.body.token;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('runs QR → kitchen → waiter → pay → COMPLETED', async () => {
    const menu = await request(app.getHttpServer())
      .get(`/api/customer/${qrToken}/menu`)
      .expect(200);

    const itemId = menu.body.categories?.[0]?.menuItems?.[0]?.id;
    expect(itemId).toBeTruthy();

    const created = await request(app.getHttpServer())
      .post(`/api/customer/${qrToken}/orders`)
      .send({
        customerName: 'E2E Guest',
        items: [{ menuItemId: itemId, quantity: 1 }],
      });
    expect([200, 201]).toContain(created.status);

    const orderId = created.body.id as string;
    expect(created.body.status).toBe('NEW');

    const kitchenMe = await request(app.getHttpServer())
      .get('/api/kitchen/me')
      .set('x-device-token', kitchenDeviceToken)
      .expect(200);
    expect(kitchenMe.body.deviceType).toBe('KITCHEN');

    const tickets = await request(app.getHttpServer())
      .get('/api/kitchen/tickets')
      .set('x-device-token', kitchenDeviceToken)
      .expect(200);
    expect(tickets.body.some((t: { id: string }) => t.id === orderId)).toBe(
      true,
    );

    for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
      const advanced = await request(app.getHttpServer())
        .patch(`/api/kitchen/orders/${orderId}/status`)
        .set('x-device-token', kitchenDeviceToken)
        .send({ status })
        .expect(200);
      expect(advanced.body.status).toBe(status);
    }

    const waiterOrders = await request(app.getHttpServer())
      .get('/api/waiter/orders')
      .set('x-device-token', waiterDeviceToken)
      .expect(200);
    expect(waiterOrders.body.some((o: { id: string }) => o.id === orderId)).toBe(
      true,
    );

    const served = await request(app.getHttpServer())
      .patch(`/api/waiter/orders/${orderId}/status`)
      .set('x-device-token', waiterDeviceToken)
      .send({ status: 'SERVED' })
      .expect(200);
    expect(served.body.status).toBe('SERVED');

    const payment = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        orderId,
        method: 'CASH',
        status: 'PAID',
      });
    expect([200, 201]).toContain(payment.status);
    expect(payment.body.status).toBe('PAID');

    const finalOrder = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(finalOrder.body.status).toBe('COMPLETED');
    expect(finalOrder.body.payment?.status).toBe('PAID');
  }, 90_000);
});
